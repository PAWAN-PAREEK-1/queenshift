import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import userRoutes from "./routes/userRoutes.js";
import { connectDB } from "./models/db.js";

const app = express();
app.use(cors());
app.use(express.json({limit:"50mb"}));
dotenv.config();
// connect to MongoDB

connectDB().catch(err => {
  console.error("Initial MongoDB connection failed", err);
  process.exit(1); // exit if DB cannot connect
});
app.use("/api/user", userRoutes);

// start server
app.listen(3000, () => console.log("Server running on port 3000"));
