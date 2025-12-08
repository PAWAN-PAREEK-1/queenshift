import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import userRoutes from "./routes/userRoutes.js";

const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();
// connect to MongoDB
mongoose
  .connect(process.env.MONOGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log(err));

app.use("/api/user", userRoutes);

// start server
app.listen(3000, () => console.log("Server running on port 3000"));
