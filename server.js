import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Load biến môi trường từ file .env
dotenv.config();

// ==========================================
// 1. KHỞI TẠO SERVER & DATABASE (SUPABASE)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: '*' }));

// Khởi tạo Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Thiếu cấu hình Supabase trong biến môi trường!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// 2. HELPER FUNCTIONS & MIDDLEWARES
// ==========================================

const sendResponse = (res, data = null, message = '') => {
  res.status(200).json({ success: true, data, message });
};

const sendError = (res, status, message, errorDetails = null) => {
  console.error(`[Error] ${message}`, errorDetails || '');
  res.status(status).json({ success: false, message });
};

// Middleware kiểm tra dữ liệu đầu vào cho Transaction
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

// ==========================================
// 3. API ROUTES
// ==========================================

// --- AUTH API ---
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const correctPassword = `admin_${dd}${mm}${yyyy}`;

    if (username === 'Admin' && password === correctPassword) {
      sendResponse(res, null, "Đăng nhập thành công");
    } else {
      sendError(res, 401, "Sai tài khoản hoặc mật khẩu");
    }
  } catch (error) {
    sendError(res, 500, "Lỗi server khi đăng nhập", error);
  }
});

// --- I. TRANSACTIONS CRUD ---

app.get('/api/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, type } = req.query;
    
    let query = supabase.from('transactions').select('*', { count: 'exact' });

    if (type && type !== 'all') {
      query = query.eq('type', type);
    }
    
    // Tìm kiếm tương đối theo description hoặc category
    if (search) {
      query = query.or(`description.ilike.%${search}%,category.ilike.%${search}%`);
    }

    const start = (page - 1) * limit;
    const end = start + Number(limit) - 1;

    const { data, error, count } = await query
      .order('date', { ascending: false })
      .range(start, end);

    if (error) throw error;

    sendResponse(res, {
      transactions: data,
      total: count,
      page: Number(page),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    sendError(res, 500, "Lỗi khi lấy danh sách giao dịch", error);
  }
});

app.post('/api/transactions', validateTransaction, async (req, res) => {
  try {
    const { date, type, amount, category, source, description } = req.body;
    if (!date || !type || !amount || !category) {
      return sendError(res, 400, "Thiếu thông tin bắt buộc");
    }

    const newTx = {
      id: crypto.randomUUID(), // Sử dụng crypto tạo ID an toàn
      date: new Date(date).toISOString().split('T')[0], // Đảm bảo format YYYY-MM-DD
      type, 
      amount, 
      category,
      source: source || '',
      description: description || ''
    };

    const { data, error } = await supabase.from('transactions').insert([newTx]).select();
    if (error) throw error;

    sendResponse(res, data[0], "Thêm giao dịch thành công");
  } catch (error) {
    sendError(res, 500, "Lỗi khi thêm giao dịch", error);
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;

    sendResponse(res, null, "Đã xóa giao dịch thành công");
  } catch (error) {
    sendError(res, 500, "Lỗi khi xóa giao dịch", error);
  }
});

// --- II. SAVINGS CRUD ---

app.get('/api/savings', async (req, res) => {
  try {
    const { data, error } = await supabase.from('savings').select('*').order('maturity_date', { ascending: true });
    if (error) throw error;

    // Map snake_case DB sang camelCase cho Frontend
    const formattedData = data.map(s => ({
      ...s,
      interestRate: s.interest_rate,
      maturityDate: s.maturity_date
    }));

    sendResponse(res, formattedData);
  } catch (error) {
    sendError(res, 500, "Lỗi khi tải danh sách tiết kiệm", error);
  }
});

app.post('/api/savings', async (req, res) => {
  try {
    const { name, type, interestRate, amount, maturityDate } = req.body;
    
    if (!name || !amount || !interestRate || !maturityDate) {
      return sendError(res, 400, "Thiếu thông tin bắt buộc để tạo gói tiết kiệm");
    }

    const newSaving = {
      id: crypto.randomUUID(),
      name, 
      type: type || 'savings',
      interest_rate: Number(interestRate), // DB xài snake_case
      amount: Number(amount),
      maturity_date: maturityDate
    };

    const { data, error } = await supabase.from('savings').insert([newSaving]).select();
    if (error) throw error;

    // Format lại trước khi trả về
    const formattedData = {
      ...data[0],
      interestRate: data[0].interest_rate,
      maturityDate: data[0].maturity_date
    };

    sendResponse(res, formattedData, "Thêm gói tiết kiệm/đầu tư thành công");
  } catch (error) {
    sendError(res, 500, "Lỗi khi thêm gói tiết kiệm", error);
  }
});

app.delete('/api/savings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('savings').delete().eq('id', id);
    if (error) throw error;

    sendResponse(res, null, "Đã xóa gói tiết kiệm/đầu tư");
  } catch (error) {
    sendError(res, 500, "Lỗi khi xóa gói tiết kiệm", error);
  }
});

// --- III. DASHBOARD SUMMARY & REPORTS ---

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) return sendError(res, 400, "Thiếu month hoặc year");
    
    const targetMonth = `${year}-${String(month).padStart(2, '0')}`;

    // Lấy song song Transactions và Savings để tăng tốc độ phản hồi
    const [txResult, savingsResult] = await Promise.all([
      supabase.from('transactions').select('amount, type, date, category'),
      supabase.from('savings').select('amount')
    ]);

    if (txResult.error) throw txResult.error;
    if (savingsResult.error) throw savingsResult.error;

    let totalBalance = 0;
    let allTimeIncome = 0;
    let totalIncome = 0;
    let totalExpense = 0;
    const expenseByCategory = {};

    // Xử lý Transactions
    txResult.data.forEach(t => {
      if (t.type === 'income') {
        totalBalance += t.amount;
        allTimeIncome += t.amount;
      } else {
        totalBalance -= t.amount;
      }

      // Lọc theo tháng được chọn
      if (t.date.startsWith(targetMonth)) {
        if (t.type === 'income') {
          totalIncome += t.amount;
        } else {
          totalExpense += t.amount;
          expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
        }
      }
    });

    // Tổng tiền tiết kiệm / đầu tư
    const totalSavings = savingsResult.data.reduce((sum, s) => sum + Number(s.amount), 0);

    sendResponse(res, { 
      totalIncome, 
      totalExpense, 
      allTimeIncome, 
      totalSavings, 
      totalBalance, // Tổng số dư khả dụng
      totalAssets: totalBalance + totalSavings, // Yêu cầu: Tài sản = Số dư + Tiết kiệm
      expenseByCategory 
    });
  } catch (error) {
    sendError(res, 500, "Lỗi khi tải dữ liệu tổng quan", error);
  }
});

app.get('/api/dashboard/monthly-trend', async (req, res) => {
  try {
    const { year } = req.query;
    if (!year) return sendError(res, 400, "Cần cung cấp year");

    const trend = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, income: 0, expense: 0
    }));

    const { data, error } = await supabase
      .from('transactions')
      .select('amount, type, date')
      .ilike('date', `${year}-%`); // Tìm các giao dịch trong năm đó

    if (error) throw error;

    data.forEach(t => {
      const m = parseInt(t.date.split('-')[1]) - 1;
      if (t.type === 'income') trend[m].income += t.amount;
      else trend[m].expense += t.amount;
    });

    sendResponse(res, trend);
  } catch (error) {
    sendError(res, 500, "Lỗi khi lấy xu hướng theo tháng", error);
  }
});

app.get('/api/dashboard/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    sendResponse(res, data);
  } catch (error) {
    sendError(res, 500, "Lỗi khi lấy giao dịch gần đây", error);
  }
});

app.get('/api/reports/category-breakdown', async (req, res) => {
  try {
    const { type, year, month } = req.query;
    if (!type || !year || !month) return sendError(res, 400, "Thiếu param type, year hoặc month");
    
    const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
    
    const { data, error } = await supabase
      .from('transactions')
      .select('amount, category')
      .eq('type', type)
      .ilike('date', `${targetMonth}-%`);

    if (error) throw error;

    const breakdown = {};
    data.forEach(t => {
      breakdown[t.category] = (breakdown[t.category] || 0) + t.amount;
    });

    sendResponse(res, breakdown);
  } catch (error) {
    sendError(res, 500, "Lỗi khi tạo báo cáo phân bổ", error);
  }
});

// --- IV. APP STATE & SETTINGS (Lưu trữ Cấu hình, Danh mục) ---

app.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase.from('app_state').select('value').eq('key', 'categories').single();
    
    // Nếu chưa có trong DB, trả về default fallback
    if (error || !data) {
      return sendResponse(res, {
        income: ["Tiền lương", "Tiền thưởng", "Kinh doanh", "Đầu tư", "Khác"],
        expense: ["Ăn uống", "Di chuyển", "Nhà ở", "Mua sắm", "Giải trí", "Sức khỏe", "Giáo dục", "Hiếu hỉ", "Khác"]
      });
    }

    sendResponse(res, data.value);
  } catch (error) {
    sendError(res, 500, "Lỗi khi tải danh mục", error);
  }
});

// ==========================================
// 4. KHỞI ĐỘNG SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Finly API is running on http://localhost:${PORT}`);
  console.log(`🔗 Connected to Supabase PostgreSQL`);
});