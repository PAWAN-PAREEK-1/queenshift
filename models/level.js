import mongoose from "mongoose";

const levelSchema = new mongoose.Schema({
  mode: {
    type: String,
    // enum: ["easy", "medium", "hard", "expert"],
    required: true
  },
  level: {
    type: Number,
    required: true
  },
  total_time: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 },
  average_time: { type: Number, default: 0 }
});

levelSchema.index({ mode: 1, level: 1 }, { unique: true });

export default mongoose.model("Level", levelSchema);
