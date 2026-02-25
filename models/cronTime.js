// models/SystemState.js
import mongoose from "mongoose";

const SystemStateSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  lastRunAt: Date,
});

export default mongoose.model("SystemState", SystemStateSchema);