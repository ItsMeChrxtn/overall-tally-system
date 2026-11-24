import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Setting from '../models/Setting.js';
import TabulationResult from '../models/TabulationResult.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Public endpoints only ever expose PUBLISHED results — never drafts, judge scores or unpublished tallies. */
async function assertPublicEnabled() {
  const s = await Setting.getGlobal();
  if (!s.publicResultsEnabled) throw ApiError.forbidden('Public results are currently disabled.', 'PUBLIC_DISABLED');
}

export const publicEvents = asyncHandler(async (_req, res) => {
  await assertPublicEnabled();
  const eventIds = await TabulationResult.find({ status: 'published' }).distinct('event');
  const events = await Event.find({ _id: { $in: eventIds } }, 'name description eventType venue eventDate startDate endDate coverImage status publishedAt organizer')
    .sort({ eventDate: -1, publishedAt: -1 })
    .lean();
  const counts = await TabulationResult.aggregate([{ $match: { status: 'published', event: { $in: eventIds } } }, { $group: { _id: '$event', n: { $sum: 1 } } }]);
  res.json({ success: true, items: events.map((e) => ({ ...e, publishedResults: counts.find((c) => String(c._id) === String(e._id))?.n || 0 })) });
});

export const publicEvent = asyncHandler(async (req, res) => {
  await assertPublicEnabled();
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Event not found.');
  const results = await TabulationResult.find({ event: req.params.id, status: 'published' }).sort({ scope: -1, publishedAt: -1 }).lean();
  if (!results.length) throw ApiError.notFound('No published results for this event.');
  const event = await Event.findById(req.params.id, 'name description eventType venue eventDate startDate endDate coverImage status publishedAt organizer settings').lean();
  const showScores = event.settings?.publicShowScores !== false;
  const categories = await Category.find({ event: event._id }, 'name order awardees').lean();
  const contestants = await Contestant.find({ event: event._id }, 'photo representing teamName isTeam members').lean();
  const info = Object.fromEntries(contestants.map((c) => [String(c._id), c]));

  const sections = results
    .map((r) => {
      const cat = categories.find((c) => String(c._id) === String(r.category));
      return {
        _id: r._id,
        scope: r.scope,
        title: r.title,
        order: r.scope === 'overall' ? -1 : cat?.order ?? 0,
        method: r.summary?.methodLabel,
        awardees: r.scope === 'overall' ? 3 : cat?.awardees ?? 3,
        publishedAt: r.publishedAt,
        rows: (r.rows || [])
          .filter((row) => row.rank !== null)
          .map((row) => ({
            rank: row.rank,
            tied: row.tied,
            number: row.number,
            name: row.name,
            photo: info[row.contestantId]?.photo,
            representing: info[row.contestantId]?.representing,
            members: info[row.contestantId]?.isTeam ? info[row.contestantId]?.members : undefined,
            finalScore: showScores ? row.finalScore : undefined,
          })),
        awards: (r.awards || [])
          .filter((a) => a.winners?.length)
          .map((a) => ({
            name: a.name,
            tied: a.tied,
            winners: a.winners.map((w) => ({
              number: w.number,
              name: w.name,
              photo: info[w.contestantId]?.photo,
              representing: info[w.contestantId]?.representing,
              value: showScores ? w.value : undefined,
            })),
          })),
      };
    })
    .sort((a, b) => a.order - b.order);

  delete event.settings;
  res.json({ success: true, event, showScores, sections });
});
