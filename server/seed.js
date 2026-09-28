require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, Book, Copy, Loan } = require('./models');
const { addDays } = require('./fine');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([User, Book, Copy, Loan].map((m) => m.deleteMany({})));
  await Promise.all([User, Book, Copy, Loan].map((m) => m.init()));

  const hash = (p) => bcrypt.hashSync(p, 10);
  await User.create({ name: 'Head Librarian', email: 'librarian@library.com', password: hash('lib12345'), role: 'librarian' });
  const [alice, bob, carol] = await User.create([
    { name: 'Alice (has overdue)', email: 'alice@library.com', password: hash('member123') },
    { name: 'Bob (3 loans)', email: 'bob@library.com', password: hash('member123') },
    { name: 'Carol (clean)', email: 'carol@library.com', password: hash('member123') },
  ]);

  // conditions: array of copy conditions for that book
  const addBook = async (title, author, isbn, conditions) => {
    const book = await Book.create({ title, author, isbn });
    const copies = await Copy.create(conditions.map((c, i) => ({ book: book._id, copyCode: `${isbn}-C${i + 1}`, condition: c })));
    return { book, copies };
  };
  const lend = async (member, { book, copies }, daysAgo, copyIndex = 0, returned = false, cond = 'good') => {
    const borrowDate = addDays(new Date(), -daysAgo);
    const dueDate = addDays(borrowDate, 14);
    const copy = copies[copyIndex];
    const loan = { member: member._id, book: book._id, copy: copy._id, borrowDate, dueDate };
    if (returned) Object.assign(loan, { active: false, returnDate: addDays(dueDate, 3), fine: 30, returnCondition: cond });
    else await Copy.updateOne({ _id: copy._id }, { onLoan: true });
    await Loan.create(loan);
  };

  const b1 = await addBook('Clean Code', 'Robert C. Martin', '9780132350884', ['good', 'good', 'good']);
  const b2 = await addBook('The Pragmatic Programmer', 'Andrew Hunt', '9780135957059', ['good', 'good']);
  const b3 = await addBook('Eloquent JavaScript', 'Marijn Haverbeke', '9781593279509', ['good']); // ONE copy -> test R6
  const b4 = await addBook('You Dont Know JS', 'Kyle Simpson', '9781491904244', ['damaged', 'lost']); // none lendable
  const b5 = await addBook('Design Patterns', 'Erich Gamma', '9780201633610', ['good', 'good']);
  const b6 = await addBook('Node.js in Action', 'Mike Cantelon', '9781617290572', ['good']);
  await addBook('Refactoring', 'Martin Fowler', '9780134757599', ['good']);

  await lend(alice, b1, 20);          // Alice: overdue by 6 days -> fine Rs 60, cannot borrow (R4)
  await lend(bob, b2, 3);             // Bob: 3 active loans -> limit reached (R3)
  await lend(bob, b5, 2);
  await lend(bob, b6, 1);
  await lend(carol, b1, 40, 1, true); // Carol: old returned loan (history, book can't be deleted)

  console.log('Seed done.\nLibrarian: librarian@library.com / lib12345\nMembers:   alice@library.com, bob@library.com, carol@library.com / member123');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
