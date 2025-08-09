import express from 'express';
import { handleTroubleshootingMessage } from '../agents/TroubleshootingAgent.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const { text, sessionId, ...rest } = req.body || {};
  try {
    const result = await handleTroubleshootingMessage(text || '', sessionId || 'default', rest);
    res.json(result);
  } catch (error: any) {
    console.error('Agent error:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

export default router;

