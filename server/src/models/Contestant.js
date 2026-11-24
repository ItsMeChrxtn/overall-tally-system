import mongoose from 'mongoose';
import { CONTESTANT_STATUS } from '../constants/index.js';

const contestantSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    number: { type: Number, required: true, min: 1 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    isTeam: { type: Boolean, default: false },
    teamName: { type: String, trim: true, maxlength: 160 },
    members: [{ type: String, trim: true, maxlength: 120 }],
    representing: { type: String, trim: true, maxlength: 160 }, // school, college, barangay, club...
    description: { type: String, trim: true, maxlength: 2000 },
    photo: String,
    status: { type: String, enum: CONTESTANT_STATUS, default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

contestantSchema.index({ event: 1, number: 1 }, { unique: true });

export default mongoose.model('Contestant', contestantSchema);
