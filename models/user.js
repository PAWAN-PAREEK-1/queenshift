import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    required: true,
    trim: true
  },
  avatar: {
    type: Number,
    default:0
  },
  
  frame: {
    type: Number,
    default:0
  }
});

export default mongoose.model("User", userSchema);
