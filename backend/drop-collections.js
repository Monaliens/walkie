require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected!');
  
  const db = mongoose.connection.db;
  
  const collections = await db.listCollections().toArray();
  console.log('Existing collections:', collections.map(c => c.name));
  
  // Drop Bombomb collections
  const bombombCollections = ['bombombgames', 'bombombactions', 'bombombpendingsalts'];
  
  for (const collName of bombombCollections) {
    try {
      await db.dropCollection(collName);
      console.log(`Dropped: ${collName}`);
    } catch (e) {
      console.log(`Skip: ${collName} (${e.message})`);
    }
  }
  
  console.log('Done!');
  await mongoose.disconnect();
}

main().catch(console.error);
