require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Book, Copy, Loan } = require('./models');
const { DAY, IST, addDays, startOfTodayIST, istDay, calcFine, isOverdue } = require('./fine');

const app = express();
app.use(cors());
app.use(express.json());

/* ---------- helpers ---------- */
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const checkId = (id) => { if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'INVALID_ID', 'Invalid id'); };
const CONDITIONS = ['good', 'damaged', 'lost'];

// Login check. Usage: auth() = any logged in user, auth('librarian') = librarian only
const auth = (...roles) => (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); }
  catch { return next(new ApiError(401, 'UNAUTHORIZED', 'Please log in')); }
  if (roles.length && !roles.includes(req.user.role)) return next(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this'));
  next();
};
const makeToken = (u) => jwt.sign({ id: u._id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '1d' });

// Adds overdue flag + live fine to a loan
const showLoan = (l) => {
  const o = l.toObject ? l.toObject() : l;
  if (o.active) { o.overdue = isOverdue(o.dueDate); o.fine = calcFine(o.dueDate, new Date()); }
  else o.overdue = false;
  return o;
};

/* ---------- auth ---------- */
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) throw new ApiError(400, 'VALIDATION_ERROR', 'name, email and password are required');
  if (password.length < 6) throw new ApiError(400, 'VALIDATION_ERROR', 'Password must be at least 6 characters');
  if (await User.exists({ email: email.toLowerCase() })) throw new ApiError(409, 'EMAIL_EXISTS', 'Email already registered');
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10), role: 'member' });
  res.status(201).json({ token: makeToken(user), user: { name: user.name, role: user.role } });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const user = email && (await User.findOne({ email: String(email).toLowerCase() }));
  if (!user || !password || !(await bcrypt.compare(password, user.password)))
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong email or password');
  res.json({ token: makeToken(user), user: { name: user.name, role: user.role } });
}));

/* ---------- books ---------- */
// Everyone logged in: search + availability (paginated because catalogue can be 50,000 books)
app.get('/api/books', auth(), wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const q = String(req.query.search || '').trim();
  const filter = q ? { $or: [{ $text: { $search: q } }, { isbn: q }] } : {};
  const [books, total] = await Promise.all([
    Book.find(filter).sort({ title: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Book.countDocuments(filter),
  ]);
  const counts = await Copy.aggregate([
    { $match: { book: { $in: books.map((b) => b._id) }, condition: 'good', onLoan: false } },
    { $group: { _id: '$book', n: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  books.forEach((b) => (b.availableCopies = map[String(b._id)] || 0));
  res.json({ books, total, page, pages: Math.ceil(total / limit) });
}));

app.post('/api/books', auth('librarian'), wrap(async (req, res) => {
  const { title, author, isbn } = req.body;
  const book = await Book.create({ title, author, isbn }); // duplicate isbn -> 409 in error handler
  res.status(201).json(book);
}));

app.put('/api/books/:id', auth('librarian'), wrap(async (req, res) => {
  checkId(req.params.id);
  const { title, author, isbn } = req.body;
  const book = await Book.findByIdAndUpdate(req.params.id, { title, author, isbn }, { new: true, runValidators: true });
  if (!book) throw new ApiError(404, 'NOT_FOUND', 'Book not found');
  res.json(book);
}));

// R8: a book that has ever been lent cannot be deleted
app.delete('/api/books/:id', auth('librarian'), wrap(async (req, res) => {
  checkId(req.params.id);
  if (await Loan.exists({ book: req.params.id })) throw new ApiError(409, 'BOOK_HAS_LOANS', 'This book has loan history and cannot be deleted');
  const book = await Book.findByIdAndDelete(req.params.id);
  if (!book) throw new ApiError(404, 'NOT_FOUND', 'Book not found');
  await Copy.deleteMany({ book: req.params.id });
  res.json({ message: 'Book deleted' });
}));

/* ---------- copies (librarian) ---------- */
app.get('/api/books/:id/copies', auth('librarian'), wrap(async (req, res) => {
  checkId(req.params.id);
  res.json(await Copy.find({ book: req.params.id }).sort({ copyCode: 1 }));
}));

app.post('/api/books/:id/copies', auth('librarian'), wrap(async (req, res) => {
  checkId(req.params.id);
  if (!(await Book.exists({ _id: req.params.id }))) throw new ApiError(404, 'NOT_FOUND', 'Book not found');
  const { copyCode, condition = 'good' } = req.body;
  if (!CONDITIONS.includes(condition)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid condition');
  res.status(201).json(await Copy.create({ book: req.params.id, copyCode, condition }));
}));

app.patch('/api/copies/:id', auth('librarian'), wrap(async (req, res) => {
  checkId(req.params.id);
  const { condition } = req.body;
  if (!CONDITIONS.includes(condition)) throw new ApiError(400, 'VALIDATION_ERROR', 'Condition must be good, damaged or lost');
  const copy = await Copy.findOneAndUpdate({ _id: req.params.id, onLoan: false }, { condition }, { new: true });
  if (!copy) {
    if (await Copy.exists({ _id: req.params.id })) throw new ApiError(409, 'COPY_ON_LOAN', 'Copy is on loan. Process the return first');
    throw new ApiError(404, 'NOT_FOUND', 'Copy not found');
  }
  res.json(copy);
}));

app.delete('/api/copies/:id', auth('librarian'), wrap(async (req, res) => {
  checkId(req.params.id);
  if (await Loan.exists({ copy: req.params.id })) throw new ApiError(409, 'COPY_HAS_LOANS', 'This copy has loan history and cannot be deleted');
  const copy = await Copy.findByIdAndDelete(req.params.id);
  if (!copy) throw new ApiError(404, 'NOT_FOUND', 'Copy not found');
  res.json({ message: 'Copy deleted' });
}));

/* ---------- loans ---------- */
// Member borrows a BOOK (R2). System picks the copy.
app.post('/api/loans', auth('member'), wrap(async (req, res) => {
  const { bookId } = req.body;
  checkId(bookId);
  if (!(await Book.exists({ _id: bookId }))) throw new ApiError(404, 'NOT_FOUND', 'Book not found');

  const active = await Loan.find({ member: req.user.id, active: true }).lean();
  if (active.some((l) => isOverdue(l.dueDate))) throw new ApiError(403, 'HAS_OVERDUE', 'Return your overdue books before borrowing'); // R4
  if (active.some((l) => String(l.book) === bookId)) throw new ApiError(409, 'ALREADY_BORROWED', 'You already have this book on loan'); // R5
  if (active.length >= 3) throw new ApiError(409, 'LOAN_LIMIT', 'You can borrow at most 3 books at a time'); // R3

  // R6: ONE atomic database step "find a free good copy AND mark it on loan".
  // If two members hit the last copy together, MongoDB lets only one of them win.
  const copy = await Copy.findOneAndUpdate(
    { book: bookId, condition: 'good', onLoan: false },
    { onLoan: true },
    { new: true }
  );
  if (!copy) throw new ApiError(409, 'NO_COPY_AVAILABLE', 'No copy of this book is available right now');

  const now = new Date();
  try {
    const loan = await Loan.create({ member: req.user.id, book: bookId, copy: copy._id, borrowDate: now, dueDate: addDays(now, 14) });
    res.status(201).json(loan);
  } catch (e) {
    await Copy.updateOne({ _id: copy._id }, { onLoan: false }); // give the copy back if the loan failed
    throw e;
  }
}));

app.get('/api/loans/my', auth('member'), wrap(async (req, res) => {
  const loans = await Loan.find({ member: req.user.id }).sort({ borrowDate: -1 })
    .populate('book', 'title isbn').populate('copy', 'copyCode');
  res.json(loans.map(showLoan));
}));

// Librarian: ?status=active | overdue | returned (empty = all)
app.get('/api/loans', auth('librarian'), wrap(async (req, res) => {
  const { status } = req.query;
  let filter = {};
  if (status === 'active') filter = { active: true };
  else if (status === 'returned') filter = { active: false };
  else if (status === 'overdue') filter = { active: true, dueDate: { $lt: startOfTodayIST() } };
  else if (status) throw new ApiError(400, 'VALIDATION_ERROR', 'status must be active, overdue or returned');
  const loans = await Loan.find(filter).sort({ borrowDate: -1 }).limit(200)
    .populate('book', 'title isbn').populate('copy', 'copyCode').populate('member', 'name email');
  res.json(loans.map(showLoan));
}));

// R7: only librarian returns. Fine + condition recorded. Only once.
app.post('/api/loans/:id/return', auth('librarian'), wrap(async (req, res) => {
  checkId(req.params.id);
  const { condition = 'good' } = req.body;
  if (!CONDITIONS.includes(condition)) throw new ApiError(400, 'VALIDATION_ERROR', 'Condition must be good, damaged or lost');
  const loan = await Loan.findById(req.params.id);
  if (!loan) throw new ApiError(404, 'NOT_FOUND', 'Loan not found');

  const now = new Date();
  // only succeeds if the loan is still active -> a loan can be returned only once
  const updated = await Loan.findOneAndUpdate(
    { _id: loan._id, active: true },
    { active: false, returnDate: now, fine: calcFine(loan.dueDate, now), returnCondition: condition },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'ALREADY_RETURNED', 'This loan was already returned');
  await Copy.updateOne({ _id: loan.copy }, { onLoan: false, condition }); // damaged/lost copies can't be lent
  res.json(updated);
}));

/* ---------- reports (MongoDB versions of Q1 and Q2) ---------- */
app.get('/api/reports/top-books', auth('librarian'), wrap(async (req, res) => {
  const since = new Date(Date.now() - 30 * DAY);
  res.json(await Loan.aggregate([
    { $match: { borrowDate: { $gte: since } } },
    { $group: { _id: '$book', borrowCount: { $sum: 1 } } },
    { $sort: { borrowCount: -1 } },
    { $limit: 5 },
    { $lookup: { from: 'books', localField: '_id', foreignField: '_id', as: 'book' } },
    { $unwind: '$book' },
    { $project: { _id: 0, title: '$book.title', isbn: '$book.isbn', borrowCount: 1 } },
  ]));
}));

app.get('/api/reports/overdue-members', auth('librarian'), wrap(async (req, res) => {
  const today = istDay(new Date());
  res.json(await Loan.aggregate([
    { $match: { active: true, dueDate: { $lt: startOfTodayIST() } } },
    { $addFields: { daysLate: { $subtract: [today, { $floor: { $divide: [{ $add: [{ $toLong: '$dueDate' }, IST] }, DAY] } }] } } },
    { $group: { _id: '$member', overdueLoans: { $sum: 1 }, totalFine: { $sum: { $multiply: ['$daysLate', 10] } } } },
    { $sort: { totalFine: -1 } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'm' } },
    { $unwind: '$m' },
    { $project: { _id: 0, name: '$m.name', email: '$m.email', overdueLoans: 1, totalFine: 1 } },
  ]));
}));

/* ---------- errors: always { error: { code, message } } ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use((err, req, res, next) => {
  let { status, code, message } = err;
  if (err.name === 'ValidationError') { status = 400; code = 'VALIDATION_ERROR'; message = Object.values(err.errors).map((e) => e.message).join(', '); }
  else if (err.code === 11000) { status = 409; code = 'DUPLICATE'; message = `${Object.keys(err.keyPattern || {})[0] || 'value'} already exists`; }
  else if (err.type === 'entity.parse.failed') { status = 400; code = 'BAD_JSON'; message = 'Invalid JSON body'; }
  else if (!status) { console.error(err); status = 500; code = 'SERVER_ERROR'; message = 'Something went wrong'; }
  res.status(status).json({ error: { code, message } });
});

/* ---------- start ---------- */
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    await Promise.all([User, Book, Copy, Loan].map((m) => m.init())); // make sure indexes exist
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((e) => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
