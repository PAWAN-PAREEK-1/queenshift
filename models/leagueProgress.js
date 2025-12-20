// models/LeagueProgress.js
import mongoose from "mongoose";

const LeagueProgressSchema = new mongoose.Schema(
  {
    playerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    total_score: {
      type: Number,
      default: 0,
    },

    league: {
      name: {
        type: String, // gold | diamond
        default: "gold",
      },
      level: {
        type: Number, // 1 | 2 | 3
        default: 1,
      },
    },
  },
  { timestamps: true }
);



export default mongoose.model("LeagueProgress", LeagueProgressSchema);
