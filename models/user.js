import mongoose from "mongoose";

const levelProgressSchema = new mongoose.Schema({
  current_level: { type: Number, default: 0 },
  // Stores total time taken for each level
  level_times: {
    type: Map,
    of: Number,  // { "1": 23, "2": 30 ... seconds }
    default: {}
  },
  average_time: { type: Number, default: 0 }
});

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    required: true,
    trim: true
  },
  avatar_index: { type: Number, default: 0 },
  frame_index: { type: Number, default: 0 },

  levels: {
    easy: { type: levelProgressSchema, default: () => ({}) },
    medium: { type: levelProgressSchema, default: () => ({}) },
    hard: { type: levelProgressSchema, default: () => ({}) },
    expert: { type: levelProgressSchema, default: () => ({}) },
    dailyquest: { type: levelProgressSchema, default: () => ({}) },
    weeklychallenge: { type: levelProgressSchema, default: () => ({}) },
    theleague: { type: levelProgressSchema, default: () => ({}) },
    timerush: { type: levelProgressSchema, default: () => ({}) },
    twistermode: { type: levelProgressSchema, default: () => ({}) },
  },
    playerId:{
    type:String,
    required:true
  }
});

export default mongoose.model("User", userSchema);
