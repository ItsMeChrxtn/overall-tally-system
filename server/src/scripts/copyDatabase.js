/**
 * Copies every collection (documents + indexes) from one MongoDB database to another,
 * e.g. from your local database to MongoDB Atlas before going live.
 *
 *   node src/scripts/copyDatabase.js --from "mongodb://127.0.0.1:27017/overall_tally" --to "mongodb+srv://USER:PASS@cluster.../overall_tally"
 *
 * Refuses to write into a target that already has data unless --force is given
 * (with --force, target collections that also exist in the source are replaced).
 */
import { MongoClient } from 'mongodb';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const from = arg('from');
const to = arg('to');
const force = process.argv.includes('--force');
if (!from || !to) {
  console.error('Usage: node src/scripts/copyDatabase.js --from <source uri> --to <target uri> [--force]');
  process.exit(1);
}

const src = new MongoClient(from);
const dst = new MongoClient(to);
try {
  await Promise.all([src.connect(), dst.connect()]);
  const sdb = src.db();
  const ddb = dst.db();
  if (sdb.databaseName === ddb.databaseName && from === to) throw new Error('Source and target are the same.');
  console.log(`[copy-db] ${sdb.databaseName} -> ${ddb.databaseName}`);

  const existing = (await ddb.listCollections().toArray()).map((c) => c.name);
  let targetHasData = false;
  for (const name of existing) if (await ddb.collection(name).estimatedDocumentCount()) targetHasData = true;
  if (targetHasData && !force) throw new Error('The target database already has data. Re-run with --force to replace it.');

  for (const { name, type } of await sdb.listCollections().toArray()) {
    if (type !== 'collection' || name.startsWith('system.')) continue;
    if (existing.includes(name)) await ddb.collection(name).drop();
    const docs = await sdb.collection(name).find().toArray();
    if (docs.length) await ddb.collection(name).insertMany(docs, { ordered: false });
    const indexes = (await sdb.collection(name).indexes()).filter((i) => i.name !== '_id_');
    for (const { key, name: iname, v, ns, ...opts } of indexes) await ddb.collection(name).createIndex(key, { name: iname, ...opts });
    console.log(`  ${name}: ${docs.length} document(s), ${indexes.length} index(es)`);
  }
  console.log('[copy-db] Done. Uploaded images (server/uploads) are files, not database data, and are not copied.');
} catch (err) {
  console.error(`[copy-db] ${err.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all([src.close(), dst.close()]);
}
