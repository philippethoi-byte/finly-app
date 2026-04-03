import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: '*' }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Thiếu cấu hình Supabase!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- HELPERS ---
const sendResponse = (res, data = null, message = '') => {
  res.status(200).json({ success: true, data, message });
};

const sendError = (res, status, message, errorDetails = null) => {
  console.error(`[Error] ${message}`, errorDetails || '');
  res.status(status).json({ success: false, message });
};

// Hàm bổ trợ để tạo range ngày tháng (Quan trọng để fix lỗi 0đ)
const getDateRange = (year, month) => {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
  const nextYear = parseInt(month) === 12 ? parseInt(year) + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end };
};

// --- ROUTES ---

app.get('/', (req, res) => res.send("Finly API is running perfectly!"));

// 1. Đăng nhập với mật khẩu chuẩn hóa ngày tháng
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0'); // Tháng trong JS từ 0-11
  const yyyy = now.getFullYear();
  
  const correctPassword = `admin_${dd}${mm}${yyyy}`;

  if (username === 'Admin' && password === correctPassword) {
    sendResponse(res, { token: 'fake-jwt-token', user: 'Admin' }, "Đăng nhập thành công");
  } else {
    sendError(res, 401, "Sai tài khoản hoặc mật khẩu hôm nay");
  }
});

// 2. Lấy Dashboard Summary (Đã fix Query)
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const { month, year } = req.query;
    const { start, end } = getDateRange(year, month);

    // Lấy dữ liệu tháng hiện tại
    const { data: currentData, error: currentError } = await supabase
      .from('transactions')
      .select('amount, type')
      .gte('date', start)
      .lt('date', end);

    if (currentError) throw currentError;

    let totalIncome = 0;
    let totalExpense = 0;
    currentData.forEach(t => {
      if (t.type === 'income') totalIncome += Number(t.amount);
      if (t.type === 'expense') totalExpense += Number(t.amount);
    });

    // Tính tổng số dư (Balance) - Toàn bộ thời gian
    const { data: allData, error: allError } = await supabase
      .from('transactions')
      .select('amount, type');
    
    if (allError) throw allError;
    
    const totalBalance = allData.reduce((acc, t) => {
      return t.type === 'income' ? acc + Number(t.amount) : acc - Number(t.amount);
    }, 0);

    sendResponse(res, {
      totalIncome,
      totalExpense,
      totalBalance,
      incomeProgress: 75, // Có thể tính toán dựa trên mục tiêu sau này
      balanceChange: 12 // Giả lập % thay đổi
    });
  } catch (error) {
    sendError(res, 500, "Lỗi server khi lấy dashboard", error);
  }
});

// 3. Lấy danh sách giao dịch (Đã tối ưu filter)
app.get('/api/transactions', async (req, res) => {
  try {
    const { type, month, year } = req.query;
    let query = supabase.from('transactions').select('*').order('date', { ascending: false });

    if (type && type !== 'all') {
      query = query.eq('type', type);
    }

    if (month && year) {
      const { start, end } = getDateRange(year, month);
      query = query.gte('date', start).lt('date', end);
    }

    const { data, error } = await query;
    if (error) throw error;
    sendResponse(res, data);
  } catch (error) {
    sendError(res, 500, "Lỗi khi lấy danh sách giao dịch", error);
  }
});

// 4. Thêm giao dịch mới
app.post('/api/transactions', async (req, res) => {
  try {
    const { date, type, amount, category, source, description } = req.body;
    const { data, error } = await supabase
      .from('transactions')
      .insert([{ date, type, amount: Number(amount), category, source, description }])
      .select();

    if (error) throw error;
    sendResponse(res, data[0], "Thêm giao dịch thành công");
  } catch (error) {
    sendError(res, 500, "Lỗi khi lưu giao dịch", error);
  }
});

// 5. Báo cáo phân bổ (Category Breakdown)
app.get('/api/reports/category-breakdown', async (req, res) => {
  try {
    const { type, month, year } = req.query;
    const { start, end } = getDateRange(year, month);

    const { data, error } = await supabase
      .from('transactions')
      .select('amount, category')
      .eq('type', type)
      .gte('date', start)
      .lt('date', end);

    if (error) throw error;

    const breakdown = {};
    data.forEach(t => {
      breakdown[t.category] = (breakdown[t.category] || 0) + Number(t.amount);
    });

    sendResponse(res, breakdown);
  } catch (error) {
    sendError(res, 500, "Lỗi khi tạo báo cáo", error);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Finly API is running on http://localhost:${PORT}`);
});