import { useState, useEffect, useCallback } from 'react';

/* ---------- api helper ---------- */
async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}

// loads data with loading + error state
function useLoad(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true); setError('');
    api(path).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [path]);
  useEffect(load, [load]);
  return { data, loading, error, reload: load };
}

const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
const Status = ({ loading, error }) => (loading ? <p className="muted">Loading…</p> : error ? <p className="err">{error}</p> : null);

/* ---------- login / register ---------- */
function AuthForm({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const data = await api('/auth/' + mode, { method: 'POST', body: f });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <form className="box narrow" onSubmit={submit}>
      <h2>{mode === 'login' ? 'Log in' : 'Create member account'}</h2>
      {mode === 'register' && <input placeholder="Name" value={f.name} onChange={set('name')} required />}
      <input type="email" placeholder="Email" value={f.email} onChange={set('email')} required />
      <input type="password" placeholder="Password" value={f.password} onChange={set('password')} required />
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Register'}</button>
        <button type="button" className="ghost" style={{ color: 'var(--ink)' }} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New member? Register' : 'Have an account? Log in'}
        </button>
      </div>
    </form>
  );
}

/* ---------- shared: book search ---------- */
function useBookSearch() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const res = useLoad(`/books?page=${page}&search=${encodeURIComponent(q)}`);
  const searchBar = (
    <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(search); }}>
      <input placeholder="Search title, author or exact ISBN" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 280 }} />
      <button>Search</button>
    </form>
  );
  const pager = res.data && (
    <div className="row">
      <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {res.data.page} of {res.data.pages || 1} ({res.data.total} books)</span>
      <button disabled={page >= res.data.pages} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
  return { ...res, searchBar, pager };
}

/* ---------- member ---------- */
function MemberBooks() {
  const { data, loading, error, reload, searchBar, pager } = useBookSearch();
  const [msg, setMsg] = useState({ type: '', text: '' });

  const borrow = async (id) => {
    setMsg({ type: '', text: '' });
    try { await api('/loans', { method: 'POST', body: { bookId: id } }); setMsg({ type: 'ok', text: 'Book borrowed. Check My loans for the due date.' }); reload(); }
    catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  return (
    <div>
      <h2>Find books</h2>
      {searchBar}
      {msg.text && <p className={msg.type}>{msg.text}</p>}
      <Status loading={loading} error={error} />
      {data && (
        <div className="scroll"><table>
          <thead><tr><th>Title</th><th>Author</th><th>ISBN</th><th>Available</th><th></th></tr></thead>
          <tbody>
            {data.books.map((b) => (
              <tr key={b._id}>
                <td>{b.title}</td><td>{b.author}</td><td>{b.isbn}</td>
                <td><span className={'tag ' + (b.availableCopies ? 'good' : 'bad')}>{b.availableCopies ? `${b.availableCopies} available` : 'None available'}</span></td>
                <td><button disabled={!b.availableCopies} onClick={() => borrow(b._id)}>Borrow</button></td>
              </tr>
            ))}
            {!data.books.length && <tr><td colSpan="5" className="muted">No books found. Try a different search.</td></tr>}
          </tbody>
        </table></div>
      )}
      {pager}
    </div>
  );
}

function MyLoans() {
  const { data, loading, error } = useLoad('/loans/my');
  return (
    <div>
      <h2>My loans</h2>
      <Status loading={loading} error={error} />
      {data && (
        <div className="scroll"><table>
          <thead><tr><th>Book</th><th>Borrowed</th><th>Due</th><th>Status</th><th>Fine</th></tr></thead>
          <tbody>
            {data.map((l) => (
              <tr key={l._id}>
                <td>{l.book?.title}<div className="muted">{l.copy?.copyCode}</div></td>
                <td>{fmt(l.borrowDate)}</td><td>{fmt(l.dueDate)}</td>
                <td>{!l.active ? <span className="tag">Returned {fmt(l.returnDate)}</span> : l.overdue ? <span className="tag bad">Overdue</span> : <span className="tag good">On loan</span>}</td>
                <td>Rs {l.fine}{l.active && l.fine > 0 ? ' so far' : ''}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan="5" className="muted">You have not borrowed anything yet.</td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

/* ---------- librarian ---------- */
function CopiesPanel({ book }) {
  const { data, loading, error, reload } = useLoad(`/books/${book._id}/copies`);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const run = async (fn) => { setMsg(''); try { await fn(); reload(); } catch (e) { setMsg(e.message); } };

  return (
    <div className="box">
      <b>Copies of {book.title}</b>
      <Status loading={loading} error={error} />
      {msg && <p className="err">{msg}</p>}
      {data && (
        <table>
          <tbody>
            {data.map((c) => (
              <tr key={c._id}>
                <td>{c.copyCode}</td>
                <td>{c.onLoan ? <span className="tag">On loan</span> : <span className="muted">In library</span>}</td>
                <td>
                  <select value={c.condition} disabled={c.onLoan} onChange={(e) => run(() => api('/copies/' + c._id, { method: 'PATCH', body: { condition: e.target.value } }))}>
                    <option>good</option><option>damaged</option><option>lost</option>
                  </select>
                </td>
                <td><button className="danger" onClick={() => run(() => api('/copies/' + c._id, { method: 'DELETE' }))}>Delete</button></td>
              </tr>
            ))}
            {!data.length && <tr><td className="muted">No copies yet.</td></tr>}
          </tbody>
        </table>
      )}
      <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/books/${book._id}/copies`, { method: 'POST', body: { copyCode: code } }); setCode(''); }); }}>
        <input placeholder="New copy code" value={code} onChange={(e) => setCode(e.target.value)} required />
        <button>Add copy</button>
      </form>
    </div>
  );
}

function LibrarianBooks() {
  const { data, loading, error, reload, searchBar, pager } = useBookSearch();
  const empty = { title: '', author: '', isbn: '' };
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');

  const save = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      if (editId) await api('/books/' + editId, { method: 'PUT', body: form });
      else await api('/books', { method: 'POST', body: form });
      setForm(empty); setEditId(null); reload();
    } catch (err) { setMsg(err.message); }
  };
  const del = async (id) => { setMsg(''); try { await api('/books/' + id, { method: 'DELETE' }); reload(); } catch (err) { setMsg(err.message); } };

  return (
    <div>
      <h2>Manage books</h2>
      <form className="box row" onSubmit={save}>
        <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <input placeholder="Author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} required />
        <input placeholder="ISBN" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} required />
        <button>{editId ? 'Save changes' : 'Add book'}</button>
        {editId && <button type="button" className="ghost" style={{ color: 'var(--ink)' }} onClick={() => { setEditId(null); setForm(empty); }}>Cancel</button>}
      </form>
      {msg && <p className="err">{msg}</p>}
      {searchBar}
      <Status loading={loading} error={error} />
      {data && (
        <div className="scroll"><table>
          <thead><tr><th>Title</th><th>Author</th><th>ISBN</th><th>Available</th><th></th></tr></thead>
          <tbody>
            {data.books.map((b) => (
              <tr key={b._id}>
                <td>{b.title}{open === b._id && <CopiesPanel book={b} />}</td>
                <td>{b.author}</td><td>{b.isbn}</td><td>{b.availableCopies}</td>
                <td>
                  <div className="row">
                    <button onClick={() => setOpen(open === b._id ? null : b._id)}>Copies</button>
                    <button className="ghost" style={{ color: 'var(--ink)' }} onClick={() => { setEditId(b._id); setForm({ title: b.title, author: b.author, isbn: b.isbn }); window.scrollTo(0, 0); }}>Edit</button>
                    <button className="danger" onClick={() => del(b._id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {pager}
    </div>
  );
}

function LibrarianLoans() {
  const [status, setStatus] = useState('active');
  const { data, loading, error, reload } = useLoad('/loans?status=' + status);
  const [cond, setCond] = useState({});
  const [msg, setMsg] = useState('');

  const doReturn = async (id) => {
    setMsg('');
    try {
      const r = await api(`/loans/${id}/return`, { method: 'POST', body: { condition: cond[id] || 'good' } });
      setMsg(`Returned. Fine: Rs ${r.fine}`); reload();
    } catch (e) { setMsg(e.message); }
  };

  return (
    <div>
      <h2>Loans</h2>
      <div className="tabs">
        {['active', 'overdue', 'returned'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
      </div>
      {msg && <p className={msg.startsWith('Returned') ? 'ok' : 'err'}>{msg}</p>}
      <Status loading={loading} error={error} />
      {data && (
        <div className="scroll"><table>
          <thead><tr><th>Book</th><th>Member</th><th>Due</th><th>Fine</th><th></th></tr></thead>
          <tbody>
            {data.map((l) => (
              <tr key={l._id}>
                <td>{l.book?.title}<div className="muted">{l.copy?.copyCode}</div></td>
                <td>{l.member?.name}<div className="muted">{l.member?.email}</div></td>
                <td>{fmt(l.dueDate)} {l.overdue && <span className="tag bad">Overdue</span>}</td>
                <td>Rs {l.fine}</td>
                <td>
                  {l.active ? (
                    <div className="row">
                      <select value={cond[l._id] || 'good'} onChange={(e) => setCond({ ...cond, [l._id]: e.target.value })}>
                        <option>good</option><option>damaged</option><option>lost</option>
                      </select>
                      <button onClick={() => doReturn(l._id)}>Return</button>
                    </div>
                  ) : <span className="muted">Returned {fmt(l.returnDate)} ({l.returnCondition})</span>}
                </td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan="5" className="muted">No {status} loans.</td></tr>}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function Reports() {
  const top = useLoad('/reports/top-books');
  const over = useLoad('/reports/overdue-members');
  return (
    <div>
      <h2>Reports</h2>
      <h3>Top 5 borrowed books (last 30 days)</h3>
      <Status loading={top.loading} error={top.error} />
      {top.data && <table><thead><tr><th>Title</th><th>ISBN</th><th>Times borrowed</th></tr></thead><tbody>
        {top.data.map((r) => <tr key={r.isbn}><td>{r.title}</td><td>{r.isbn}</td><td>{r.borrowCount}</td></tr>)}
        {!top.data.length && <tr><td colSpan="3" className="muted">No loans in the last 30 days.</td></tr>}
      </tbody></table>}
      <h3>Members with overdue loans</h3>
      <Status loading={over.loading} error={over.error} />
      {over.data && <table><thead><tr><th>Member</th><th>Overdue loans</th><th>Fine if returned today</th></tr></thead><tbody>
        {over.data.map((r) => <tr key={r.email}><td>{r.name}<div className="muted">{r.email}</div></td><td>{r.overdueLoans}</td><td>Rs {r.totalFine}</td></tr>)}
        {!over.data.length && <tr><td colSpan="3" className="muted">No overdue loans.</td></tr>}
      </tbody></table>}
    </div>
  );
}

/* ---------- app shell ---------- */
export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } });
  const [tab, setTab] = useState('books');
  const logout = () => { localStorage.clear(); setUser(null); setTab('books'); };

  if (!user) return <main><AuthForm onLogin={setUser} /></main>;

  const tabs = user.role === 'librarian'
    ? [['books', 'Books'], ['loans', 'Loans'], ['reports', 'Reports']]
    : [['books', 'Find books'], ['loans', 'My loans']];

  return (
    <>
      <header>
        <b>Library</b>
        <span>{user.name} ({user.role}) <button className="ghost" onClick={logout} style={{ marginLeft: 12 }}>Log out</button></span>
      </header>
      <main>
        <div className="tabs">
          {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        {user.role === 'librarian'
          ? tab === 'books' ? <LibrarianBooks /> : tab === 'loans' ? <LibrarianLoans /> : <Reports />
          : tab === 'books' ? <MemberBooks /> : <MyLoans />}
      </main>
    </>
  );
}
