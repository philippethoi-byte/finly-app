import express from 'express';
import cors from 'cors';
import crypto from 'crypto'; // Dùng thư viện có sẵn của Node.js thay cho nanoid
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Khởi tạo kết nối Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const sendResponse = (res, data, message = "Success") => res.json({ success: true, data, message });
const sendError = (res, status, message) => res.status(status).json({ success: false, message });

// ==========================================
// 1. API ĐĂNG NHẬP (LOGIN)
// ==========================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const correctPassword = `admin_${dd}${mm}${yyyy}`;

  if (username === 'Admin' && password === correctPassword) {
    res.json({ success: true, message: "Đăng nhập thành công" });
  } else {
    res.status(401).json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });
  }
});

// ==========================================
// 2. API DASHBOARD (TỔNG QUAN)
// ==========================================
app.get('/api/dashboard/summary', async (req, res) => {
  const { month, year } = req.query;
  const targetMonth = `${year}-${String(month).padStart(2, '0')}`;

  // Lấy toàn bộ giao dịch để tính số dư tổng
  const { data: allTxs } = await supabase.from('transactions').select('amount, type, date, category');
  let totalBalance = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  const expenseByCategory = {};

  if (allTxs) {
    allTxs.forEach(t => {
      const amt = Number(t.amount) || 0;
      // Cộng dồn tất cả thời gian cho số dư
      if (t.type === 'income') totalBalance += amt;
      else totalBalance -= amt;

      // Tính riêng cho tháng hiện tại
      if (t.date && t.date.startsWith(targetMonth)) {
        if (t.type === 'income') {
          totalIncome += amt;
        } else {
          totalExpense += amt;
          expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + amt;
        }
      }
    });
  }

  // Lấy tổng tiết kiệm
  const { data: allSavings } = await supabase.from('savings').select('amount');
  const totalSavings = allSavings?.reduce((sum, s) => sum + (Number(s.amount) || 0), 0) || 0;

  sendResponse(res, { totalBalance, totalSavings, totalIncome, totalExpense, expenseByCategory });
});

app.get('/api/dashboard/recent', async (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  const { data } = await supabase.from('transactions').select('*').order('date', { ascending: false }).limit(limit);
  sendResponse(res, data || []);
});

app.get('/api/dashboard/monthly-trend', async (req, res) => {
  const { year } = req.query;
  const { data: txs } = await supabase.from('transactions').select('amount, type, date').like('date', `${year}-%`);
  
  const trend = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expense: 0 }));
  if (txs) {
    txs.forEach(t => {
      const m = parseInt(t.date.split('-')[1], 10);
      if (m >= 1 && m <= 12) {
        if (t.type === 'income') trend[m - 1].income += Number(t.amount) || 0;
        else trend[m - 1].expense += Number(t.amount) || 0;
      }
    });
  }
  sendResponse(res, trend);
});

// ==========================================
// 3. API GIAO DỊCH (TRANSACTIONS)
// ==========================================
app.get('/api/transactions', async (req, res) => {
  const { page = 1, limit = 10, search = '', type = 'all' } = req.query;
  let query = supabase.from('transactions').select('*', { count: 'exact' });

  if (type !== 'all') query = query.eq('type', type);
  if (search) query = query.ilike('description', `%${search}%`);

  const { data, count } = await query
    .order('date', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  res.json({ success: true, data: { transactions: data || [], total: count || 0 } });
});

app.post('/api/transactions', async (req, res) => {
  const { type, amount, date, category, source, description } = req.body;
  const id = `tx-${crypto.randomUUID()}`;
  const { data, error } = await supabase.from('transactions').insert([{ id, type, amount, date, category, source, description }]).select();
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, data[0]);
});

app.delete('/api/transactions/:id', async (req, res) => {
  await supabase.from('transactions').delete().eq('id', req.params.id);
  sendResponse(res, null, "Đã xóa");
});

// ==========================================
// 4. API TIẾT KIỆM & ĐẦU TƯ (SAVINGS)
// ==========================================
app.get('/api/savings', async (req, res) => {
  const { data, error } = await supabase.from('savings').select('*').order('created_at', { ascending: false });
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, data || []);
});

app.post('/api/savings', async (req, res) => {
  const { name, type, interestRate, amount, maturityDate } = req.body;
  const id = `sav-${crypto.randomUUID()}`;
  const { data, error } = await supabase.from('savings')
    .insert([{ id, name, type, interest_rate: interestRate, amount, maturity_date: maturityDate }])
    .select();
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, data[0]);
});

app.put('/api/savings/:id/contribute', async (req, res) => {
  const { amount } = req.body;
  const { data: saving } = await supabase.from('savings').select('amount').eq('id', req.params.id).single();
  if (!saving) return sendError(res, 404, "Không tìm thấy gói");

  const newAmount = Number(saving.amount) + Number(amount);
  const { data } = await supabase.from('savings').update({ amount: newAmount }).eq('id', req.params.id).select();
  sendResponse(res, data[0]);
});

app.delete('/api/savings/:id', async (req, res) => {
  await supabase.from('savings').delete().eq('id', req.params.id);
  sendResponse(res, null);
});

// ==========================================
// 5. API BÁO CÁO (REPORTS)
// ==========================================
app.get('/api/reports/yearly', async (req, res) => {
    // Dùng lại logic monthly-trend cho báo cáo năm
    const { year } = req.query;
    const { data: txs } = await supabase.from('transactions').select('amount, type, date').like('date', `${year}-%`);
    const trend = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expense: 0 }));
    if (txs) {
      txs.forEach(t => {
        const m = parseInt(t.date.split('-')[1], 10);
        if (m >= 1 && m <= 12) {
          if (t.type === 'income') trend[m - 1].income += Number(t.amount) || 0;
          else trend[m - 1].expense += Number(t.amount) || 0;
        }
      });
    }
    sendResponse(res, trend);
});

app.get('/api/reports/category-breakdown', async (req, res) => {
    const { month, year, type } = req.query;
    const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
    const { data: txs } = await supabase.from('transactions').select('amount, category').eq('type', type).like('date', `${targetMonth}-%`);
    
    const breakdown = {};
    if (txs) {
        txs.forEach(t => {
            breakdown[t.category] = (breakdown[t.category] || 0) + Number(t.amount);
        });
    }
    sendResponse(res, breakdown);
});

app.listen(PORT, () => console.log(`🚀 Server đang chạy tại port ${PORT}`));