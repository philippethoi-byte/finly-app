import express from 'express';
import cors from 'cors';
import { JSONFilePreset } from 'lowdb/node';
import { nanoid } from 'nanoid';

// ==========================================
// 1. KHỞI TẠO SERVER & DATABASE
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: '*' }));

// Cấu trúc Database mặc định
const defaultData = {
  transactions: [],
  savings: [], 
  budgets: {}, 
  goals: [],   
  settings: { currency: "VND", userName: "Bạn" },
  categories: {
    income: ["Tiền lương", "Tiền thưởng", "Kinh doanh", "Đầu tư", "Khác"],
    expense: ["Ăn uống", "Di chuyển", "Nhà ở", "Mua sắm", "Giải trí", "Sức khỏe", "Giáo dục", "Hiếu hỉ", "Khác"]
  }
};

const db = await JSONFilePreset('db.json', defaultData);

// ==========================================
// 2. HELPER FUNCTIONS & MIDDLEWARES
// ==========================================

const sendResponse = (res, data = null, message = '') => {
  res.json({ success: true, data, message });
};

const sendError = (res, status, message) => {
  res.status(status).json({ success: false, message });
};

const validateTransaction = (req, res, next) => {
  const { amount, date, type } = req.body;
  if (amount !== undefined && (typeof amount !== 'number' || amount <= 0)) {
    return sendError(res, 400, "Số tiền (amount) phải là số lớn hơn 0");
  }
  if (date !== undefined && isNaN(new Date(date).getTime())) {
    return sendError(res, 400, "Ngày (date) không hợp lệ. Vui lòng dùng format YYYY-MM-DD");
  }
  if (type !== undefined && !['income', 'expense'].includes(type)) {
    return sendError(res, 400, "Loại (type) chỉ được là 'income' hoặc 'expense'");
  }
  next();
};

const syncFinances = async () => {
  // 1. Reset spent của tất cả budgets về 0
  for (const monthYear in db.data.budgets) {
    for (const cat in db.data.budgets[monthYear]) {
      db.data.budgets[monthYear][cat].spent = 0;
    }
  }

  // Reset các goal
  db.data.goals.forEach(g => g.currentAmount = g.manualAmount || 0);

  // 2. Tính toán lại dựa trên tất cả transactions
  db.data.transactions.forEach(tx => {
    const monthYear = tx.date.substring(0, 7); 
    
    if (tx.type === 'expense') {
      if (!db.data.budgets[monthYear]) db.data.budgets[monthYear] = {};
      if (!db.data.budgets[monthYear][tx.category]) {
        db.data.budgets[monthYear][tx.category] = { budgetAmount: 0, spent: 0 };
      }
      db.data.budgets[monthYear][tx.category].spent += tx.amount;
    }

    if (tx.goalId) {
      const goal = db.data.goals.find(g => g.id === tx.goalId);
      if (goal) goal.currentAmount += tx.amount;
    }
  });

  await db.write();
};


// ==========================================
// 3. API ROUTES
// ==========================================

// ------------------------------------------
// I. TRANSACTIONS CRUD
// ------------------------------------------

app.get('/api/transactions', (req, res) => {
  const { page = 1, limit = 10, search, type } = req.query;
  let filtered = db.data.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(t => 
      (t.description && t.description.toLowerCase().includes(s)) || 
      t.category.toLowerCase().includes(s)
    );
  }
  
  if (type && type !== 'all') {
    filtered = filtered.filter(t => t.type === type);
  }

  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + Number(limit));

  sendResponse(res, {
    transactions: paginated,
    total: filtered.length,
    page: Number(page),
    totalPages: Math.ceil(filtered.length / limit)
  });
});

app.get('/api/transactions/:id', (req, res) => {
  const tx = db.data.transactions.find(t => t.id === req.params.id);
  if (!tx) return sendError(res, 404, "Không tìm thấy giao dịch");
  sendResponse(res, tx);
});

app.post('/api/transactions', validateTransaction, async (req, res) => {
  const { date, type, amount, category, source, description, goalId } = req.body;
  if (!date || !type || !amount || !category) return sendError(res, 400, "Thiếu thông tin bắt buộc");

  const dateObj = new Date(date);
  const dateStr = dateObj.toISOString().split('T')[0].replace(/-/g, '');
  
  const newTx = {
    id: `tx-${dateStr}-${nanoid(6).toLowerCase()}`,
    date: dateObj.toISOString().split('T')[0],
    type, amount, category,
    source: source || '',
    description: description || '',
    goalId: goalId || null,
    createdAt: new Date().toISOString()
  };

  db.data.transactions.push(newTx);
  await syncFinances(); 
  sendResponse(res, newTx, "Thêm giao dịch thành công");
});

app.put('/api/transactions/:id', validateTransaction, async (req, res) => {
  const index = db.data.transactions.findIndex(t => t.id === req.params.id);
  if (index === -1) return sendError(res, 404, "Không tìm thấy giao dịch");

  const currentTx = db.data.transactions[index];
  const updatedTx = { ...currentTx, ...req.body };
  
  if (req.body.date) updatedTx.date = new Date(req.body.date).toISOString().split('T')[0];

  db.data.transactions[index] = updatedTx;
  await syncFinances(); 
  sendResponse(res, updatedTx, "Cập nhật thành công");
});

app.delete('/api/transactions/:id', async (req, res) => {
  const index = db.data.transactions.findIndex(t => t.id === req.params.id);
  if (index === -1) return sendError(res, 404, "Không tìm thấy giao dịch");

  db.data.transactions.splice(index, 1);
  await syncFinances(); 
  sendResponse(res, null, "Đã xóa giao dịch thành công");
});


// ------------------------------------------
// II. DASHBOARD & SUMMARY (Đã gộp và sửa lỗi)
// ------------------------------------------

app.get('/api/dashboard/summary', (req, res) => {
  const { month, year } = req.query;
  const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
  
  let totalBalance = 0;
  let allTimeIncome = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  const expenseByCategory = {};

  // Tính toán Dòng tiền
  db.data.transactions.forEach(t => {
    // Tiền mặt hiện có (Toàn thời gian)
    if (t.type === 'income') {
      totalBalance += t.amount;
      allTimeIncome += t.amount;
    } else {
      totalBalance -= t.amount;
    }

    // Tiền mặt theo Tháng được chọn
    if (t.date.startsWith(targetMonth)) {
      if (t.type === 'income') {
        totalIncome += t.amount;
      } else {
        totalExpense += t.amount;
        expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
      }
    }
  });

  // Tính Tổng tiền Tiết kiệm/Đầu tư (Cộng dồn từ cả Savings và Goals)
  const planSavings = db.data.savings ? db.data.savings.reduce((sum, s) => sum + Number(s.amount), 0) : 0;
  const goalSavings = db.data.goals ? db.data.goals.reduce((s, g) => s + (Number(g.currentAmount) || 0), 0) : 0;
  const totalSavings = planSavings + goalSavings;

  // Trả về đầy đủ Variables cho Frontend
  sendResponse(res, { 
    totalIncome, 
    totalExpense, 
    allTimeIncome, 
    totalSavings, 
    totalBalance, // Biến này sửa lỗi NaN
    expenseByCategory 
  });
});

app.get('/api/dashboard/monthly-trend', (req, res) => {
  const { year } = req.query;
  if (!year) return sendError(res, 400, "Cần cung cấp year");

  const trend = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, income: 0, expense: 0
  }));

  db.data.transactions.filter(t => t.date.startsWith(year)).forEach(t => {
    const m = parseInt(t.date.split('-')[1]) - 1;
    if (t.type === 'income') trend[m].income += t.amount;
    else trend[m].expense += t.amount;
  });

  sendResponse(res, trend);
});

app.get('/api/dashboard/recent', (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  const sorted = [...db.data.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  sendResponse(res, sorted.slice(0, limit));
});


// ------------------------------------------
// III. LỊCH SỬ & STATS 
// ------------------------------------------

app.get('/api/transactions/stats', (req, res) => {
  const { startDate, endDate } = req.query;
  let txs = db.data.transactions;
  
  if (startDate) txs = txs.filter(t => t.date >= startDate);
  if (endDate) txs = txs.filter(t => t.date <= endDate);

  let income = 0, expense = 0;
  txs.forEach(t => {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  });

  sendResponse(res, { totalIncome: income, totalExpense: expense, netBalance: income - expense });
});


// ------------------------------------------
// IV. BÁO CÁO & PHÂN TÍCH (REPORTS)
// ------------------------------------------

app.get('/api/reports/monthly', (req, res) => {
  const { month, year } = req.query;
  res.redirect(`/api/dashboard/summary?month=${month}&year=${year}`);
});

app.get('/api/reports/yearly', (req, res) => {
  const { year } = req.query;
  res.redirect(`/api/dashboard/monthly-trend?year=${year}`);
});

app.get('/api/reports/category-breakdown', (req, res) => {
  const { type, year, month } = req.query;
  if (!type || !year || !month) return sendError(res, 400, "Thiếu param");
  
  const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
  const breakdown = {};
  
  db.data.transactions
    .filter(t => t.type === type && t.date.startsWith(targetMonth))
    .forEach(t => {
      breakdown[t.category] = (breakdown[t.category] || 0) + t.amount;
    });

  sendResponse(res, breakdown);
});

app.get('/api/reports/comparison', (req, res) => {
  const { year1, year2 } = req.query;
  if (!year1 || !year2) return sendError(res, 400, "Cần year1 và year2");

  const calcYear = (y) => {
    let inc = 0, exp = 0;
    db.data.transactions.filter(t => t.date.startsWith(y)).forEach(t => {
      t.type === 'income' ? inc += t.amount : exp += t.amount;
    });
    return { income: inc, expense: exp };
  };

  sendResponse(res, {
    [year1]: calcYear(year1),
    [year2]: calcYear(year2)
  });
});


// ------------------------------------------
// V. NGÂN SÁCH (BUDGETS) & MỤC TIÊU (GOALS)
// ------------------------------------------

app.post('/api/budgets', async (req, res) => {
  const { monthYear, category, amount } = req.body;
  if (!monthYear || !category || amount === undefined) return sendError(res, 400, "Thiếu thông tin");

  if (!db.data.budgets[monthYear]) db.data.budgets[monthYear] = {};
  
  const currentSpent = db.data.budgets[monthYear][category]?.spent || 0;
  db.data.budgets[monthYear][category] = { budgetAmount: Number(amount), spent: currentSpent };
  
  await syncFinances(); 
  sendResponse(res, db.data.budgets[monthYear][category], "Cập nhật ngân sách thành công");
});

app.delete('/api/budgets/:monthYear/:category', async (req, res) => {
  const { monthYear, category } = req.params;
  if (db.data.budgets[monthYear] && db.data.budgets[monthYear][category]) {
    delete db.data.budgets[monthYear][category];
    await db.write();
  }
  sendResponse(res, null, "Đã xóa ngân sách");
});

app.get('/api/budgets/overview', (req, res) => {
  const { monthYear } = req.query; 
  if (!monthYear) return sendError(res, 400, "Thiếu monthYear");

  const budgetData = db.data.budgets[monthYear] || {};
  sendResponse(res, budgetData);
});

app.post('/api/goals', async (req, res) => {
  const { name, targetAmount, deadline } = req.body;
  if (!name || !targetAmount) return sendError(res, 400, "Thiếu thông tin bắt buộc");

  const newGoal = {
    id: `goal-${nanoid(8).toLowerCase()}`,
    name,
    targetAmount,
    currentAmount: 0,
    manualAmount: 0, 
    deadline: deadline || null,
    createdAt: new Date().toISOString()
  };

  db.data.goals.push(newGoal);
  await db.write();
  sendResponse(res, newGoal, "Tạo mục tiêu thành công");
});

app.get('/api/goals', (req, res) => {
  sendResponse(res, db.data.goals);
});

app.delete('/api/goals/:id', async (req, res) => {
  db.data.goals = db.data.goals.filter(g => g.id !== req.params.id);
  await db.write();
  sendResponse(res, null, "Đã xóa mục tiêu");
});

app.put('/api/goals/:id/add-amount', async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return sendError(res, 400, "Số tiền phải lớn hơn 0");

  const goal = db.data.goals.find(g => g.id === req.params.id);
  if (!goal) return sendError(res, 404, "Không tìm thấy mục tiêu");

  goal.manualAmount = (goal.manualAmount || 0) + amount;
  await syncFinances(); 
  
  sendResponse(res, goal, "Nạp tiền vào mục tiêu thành công");
});


// ------------------------------------------
// VI. QUẢN LÝ TIẾT KIỆM (SAVINGS)
// ------------------------------------------

app.get('/api/savings', (req, res) => {
  sendResponse(res, db.data.savings || []);
});

app.post('/api/savings', async (req, res) => {
  const { name, type, interestRate, amount, maturityDate } = req.body;
  if (!db.data.savings) db.data.savings = [];
  
  const newSaving = {
    id: `sav-${Date.now()}`,
    name, type, 
    interestRate: Number(interestRate), 
    amount: Number(amount), 
    maturityDate
  };
  
  db.data.savings.push(newSaving);
  await db.write();
  sendResponse(res, newSaving, "Thêm gói thành công");
});

app.delete('/api/savings/:id', async (req, res) => {
  db.data.savings = db.data.savings.filter(s => s.id !== req.params.id);
  await db.write();
  sendResponse(res, null, "Đã xóa gói");
});

// ==========================================
// 4. KHỞI ĐỘNG SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Finly API is running on http://localhost:${PORT}`);
  console.log(`📂 Database: Lowdb (db.json) - Auto Sync Enabled`);
});