import express from 'express';
import { v4 as uuid } from 'uuid';
import { sessionStore } from '../sessionStore';
import { generateInteractiveDiagnosticResponse } from '../openaiService';
import type { DiagnosticSession } from '../types';

const router = express.Router();
router.post('/', async (req, res) => {
  const { text: userMessage, history } = req.body;
  let sessionId = req.cookies.sessionId;
  if (!sessionId) {
    sessionId = uuid();
    res.cookie('sessionId', sessionId, { httpOnly: true });
  }
  const existingSession = await sessionStore.getSession(sessionId);
  const interactive = await generateInteractiveDiagnosticResponse(userMessage, history, existingSession);
  await sessionStore.saveSession(sessionId, interactive.session);
  const { session, ...payload } = interactive;
  res.json(payload);
});
export default router;