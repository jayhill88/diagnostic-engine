import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import messageRouter from './routes/message';

dotenv.config();
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/message', messageRouter);
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));