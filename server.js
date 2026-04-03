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

// --- HELPER: Cấu trúc phản hồi thống nhất ---
const sendRes = (res, data, message = '', success = true, status = 200) => 
    res.status(status).json({ success, data, message });

// --- I. GIAO DỊCH (TRANSACTIONS) ---

// Lấy danh sách + Tìm kiếm
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

// Thêm mới
app.post('/api/transactions', async (req, res) => {
    try {
        const record = { ...req.body, id: crypto.randomUUID() };
        const { data, error } = await supabase.from('transactions').insert([record]).select();
        if (error) throw error;
        sendRes(res, data[0], "Đã thêm giao dịch");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

// Cập nhật
app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('transactions').update(req.body).eq('id', req.params.id).select();
        if (error) throw error;
        sendRes(res, data[0], "Đã cập nhật giao dịch");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

// Xóa
app.delete('/api/transactions/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('transactions').delete().eq('id', req.params.id);
        if (error) throw error;
        sendRes(res, null, "Đã xóa giao dịch");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

// --- II. TIẾT KIỆM (SAVINGS) ---

app.get('/api/savings', async (req, res) => {
    try {
        const { data, error } = await supabase.from('savings').select('*').order('maturity_date', { ascending: true });
        if (error) throw error;
        sendRes(res, data);
    } catch (e) { sendRes(res, null, e.message, false, 500); }
});

app.post('/api/savings', async (req, res) => {
    try {
        const record = { ...req.body, id: crypto.randomUUID() };
        const { data, error } = await supabase.from('savings').insert([record]).select();
        if (error) throw error;
        sendRes(res, data[0], "Đã thêm gói tiết kiệm");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

app.put('/api/savings/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('savings').update(req.body).eq('id', req.params.id).select();
        if (error) throw error;
        sendRes(res, data[0], "Đã cập nhật tiết kiệm");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

app.delete('/api/savings/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('savings').delete().eq('id', req.params.id);
        if (error) throw error;
        sendRes(res, null, "Đã xóa gói tiết kiệm");
    } catch (e) { sendRes(res, null, e.message, false, 400); }
});

// --- III. BÁO CÁO & DASHBOARD ---

app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const { data: txs } = await supabase.from('transactions').select('amount, type, category, date');
        const { data: savs } = await supabase.from('savings').select('amount');

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalBalance = 0, monthlyInc = 0, monthlyExp = 0;
        const catMap = {};

        txs.forEach(t => {
            const amt = Number(t.amount);
            const d = new Date(t.date);
            const isThisMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear;

            if (t.type === 'income') {
                totalBalance += amt;
                if (isThisMonth) monthlyInc += amt;
            } else {
                totalBalance -= amt;
                if (isThisMonth) {
                    monthlyExp += amt;
                    catMap[t.category] = (catMap[t.category] || 0) + amt;
                }
            }
        });

        const totalSavings = savs.reduce((sum, s) => sum + Number(s.amount), 0);

        sendRes(res, {
            balance: totalBalance,
            monthlyIncome: monthlyInc,
            monthlyExpense: monthlyExp,
            totalSavings: totalSavings,
            totalAssets: totalBalance + totalSavings,
            categoryBreakdown: catMap
        });
    } catch (e) { sendRes(res, null, e.message, false, 500); }
});

// Lấy danh mục từ app_state
app.get('/api/categories', async (req, res) => {
    try {
        const { data } = await supabase.from('app_state').select('value').eq('key', 'categories').single();
        sendRes(res, data?.value || { income: [], expense: [] });
    } catch (e) { sendRes(res, null, e.message, false, 500); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));