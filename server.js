import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
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

// Hàm Helper phản hồi
const sendResponse = (res, data, message = "Success") => res.json({ success: true, data, message });
const sendError = (res, status, message) => res.status(status).json({ success: false, message });

// ==========================================
// 1. API GOALS (MỤC TIÊU)
// ==========================================
app.get('/api/goals', async (req, res) => {
  const { data, error } = await supabase.from('goals').select('*').order('createdAt', { ascending: true });
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, data);
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

  const { error } = await supabase.from('goals').insert([newGoal]);
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, newGoal, "Tạo mục tiêu thành công");
});

app.put('/api/goals/:id/add-amount', async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return sendError(res, 400, "Số tiền phải lớn hơn 0");

  // Lấy goal hiện tại
  const { data: goal } = await supabase.from('goals').select('*').eq('id', req.params.id).single();
  if (!goal) return sendError(res, 404, "Không tìm thấy mục tiêu");

  const newManualAmount = Number(goal.manualAmount) + Number(amount);
  const { data, error } = await supabase.from('goals').update({ manualAmount: newManualAmount }).eq('id', req.params.id).select();
  
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, data[0], "Cập nhật thành công");
});

// ==========================================
// 2. API TRANSACTIONS (GIAO DỊCH)
// ==========================================
app.get('/api/transactions', async (req, res) => {
  const { data, error } = await supabase.from('transactions').select('*').order('date', { ascending: false });
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, data);
});

app.post('/api/transactions', async (req, res) => {
  const { type, amount, date, category, source, description } = req.body;
  const newTx = {
    id: `tx-${nanoid(8).toLowerCase()}`,
    type, amount, date, category, source, description
  };

  const { error } = await supabase.from('transactions').insert([newTx]);
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, newTx, "Thêm giao dịch thành công");
});

app.delete('/api/transactions/:id', async (req, res) => {
  const { error } = await supabase.from('transactions').delete().eq('id', req.params.id);
  if (error) return sendError(res, 500, error.message);
  sendResponse(res, null, "Đã xóa giao dịch");
});

// ==========================================
// 3. START SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});