const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });

const User = model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['member', 'librarian'], default: 'member' },
}));

const bookSchema = new Schema({
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  isbn: { type: String, required: true, unique: true, trim: true }, // R1
});
bookSchema.index({ title: 'text', author: 'text' }); // fast search for 50k books
const Book = model('Book', bookSchema);

const Copy = model('Copy', new Schema({
  book: { ...ref('Book'), required: true, index: true },
  copyCode: { type: String, required: true, unique: true, trim: true }, // R1
  condition: { type: String, enum: ['good', 'damaged', 'lost'], default: 'good' },
  onLoan: { type: Boolean, default: false },
}));

const loanSchema = new Schema({
  member: { ...ref('User'), required: true },
  book: { ...ref('Book'), required: true, index: true },
  copy: { ...ref('Copy'), required: true },
  borrowDate: { type: Date, required: true },
  dueDate: { type: Date, required: true },
  returnDate: { type: Date, default: null },
  returnCondition: { type: String, enum: ['good', 'damaged', 'lost'] },
  fine: { type: Number, default: 0 },
  active: { type: Boolean, default: true }, // true = not yet returned
});
// A member can have only one ACTIVE loan per book (R5), enforced by the database
loanSchema.index({ member: 1, book: 1 }, { unique: true, partialFilterExpression: { active: true } });
loanSchema.index({ member: 1, active: 1 });
const Loan = model('Loan', loanSchema);

module.exports = { User, Book, Copy, Loan };
