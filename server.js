import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({ origin: '*' }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Helper gửi phản hồi
const sendRes = (res, data, message = '', success = true, status = 200) => 
    res.status(status).json({ success, data, message });

// --- I. XỬ LÝ GIAO DỊCH (TRANSACTIONS) ---

app.get('/api/transactions', async (req, res) => {
    try {
        const { search, type } = req.query;
        let query = supabase.from('transactions').select('*').order('date', { ascending: false });
        if (type && type !== 'all') query = query.eq('type', type);
        if (search) query = query.ilike('description', `%${search}%`);
        const { data, error } = await query;
        if (error) throw error;
        sendRes(res, data);
    } catch (e) { sendRes(res, null, e.message, false, 500); }
});

app.post('/api/transactions', async (req, res) => {
    try {
        const payload = { ...req.body, id: crypto.randomUUID(), amount: Number(req.body.amount) };
        const { data, error } = await supabase.from('transactions').insert([payload]).select();
        if (error) throw error;
        sendRes(res, data[0], "Thêm thành công");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('transactions')
            .update({ ...req.body, amount: Number(req.body.amount) })
            .eq('id', req.params.id).select();
        if (error) throw error;
        sendRes(res, data[0], "Cập nhật thành công");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

app.delete('/api/transactions/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('transactions').delete().eq('id', req.params.id);
        if (error) throw error;
        sendRes(res, null, "Xóa thành công");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

// --- II. QUẢN LÝ TIẾT KIỆM (SAVINGS) ---

app.get('/api/savings', async (req, res) => {
    try {
        const { data, error } = await supabase.from('savings').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        sendRes(res, data);
    } catch (e) { sendRes(res, null, e.message, false, 500); }
});

app.post('/api/savings', async (req, res) => {
    try {
        const payload = { ...req.body, id: crypto.randomUUID(), amount: Number(req.body.amount) };
        const { data, error } = await supabase.from('savings').insert([payload]).select();
        if (error) throw error;
        sendRes(res, data[0], "Thêm gói tiết kiệm thành công");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

app.delete('/api/savings/:id', async (req, res) => {
    try {
        await supabase.from('savings').delete().eq('id', req.params.id);
        sendRes(res, null, "Đã xóa gói tiết kiệm");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

// --- III. BÁO CÁO & TỔNG QUAN (DASHBOARD) ---

app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const { data: txs } = await supabase.from('transactions').select('amount, type, category, date');
        const { data: savs } = await supabase.from('savings').select('amount');

        const now = new Date();
        let totalBalance = 0, monthlyInc = 0, monthlyExp = 0;
        const breakdown = {};

        txs.forEach(t => {
            const amt = Number(t.amount);
            const d = new Date(t.date);
            const isThisMonth = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

            if (t.type === 'income') {
                totalBalance += amt;
                if (isThisMonth) monthlyInc += amt;
            } else {
                totalBalance -= amt;
                if (isThisMonth) {
                    monthlyExp += amt;
                    breakdown[t.category] = (breakdown[t.category] || 0) + amt;
                }
            }
        });

        const totalSavings = (savs || []).reduce((s, a) => s + Number(a.amount), 0);

        sendRes(res, {
            balance: totalBalance,
            monthlyIncome: monthlyInc,
            monthlyExpense: monthlyExp,
            totalSavings: totalSavings,
            totalAssets: totalBalance + totalSavings,
            categoryBreakdown: breakdown
        });
    } catch (e) { sendRes(res, null, e.message, false, 500); }
});

// Lấy danh mục
app.get('/api/categories', async (req, res) => {
    try {
        const { data } = await supabase.from('app_state').select('value').eq('key', 'categories').single();
        sendRes(res, data?.value || { income: [], expense: [] });
    } catch (e) { sendRes(res, null, e.message, false, 500); }
});

// Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const now = new Date();
    const correctPass = `admin_${String(now.getDate()).padStart(2, '0')}${String(now.getMonth()+1).padStart(2, '0')}${now.getFullYear()}`;
    if (username === 'Admin' && password === 'Admin') sendRes(res, null, "OK");
    else sendRes(res, null, "Sai pass", false, 401);
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));