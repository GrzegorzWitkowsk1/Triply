import "dotenv/config";
import { seedDestinations } from "./destinations.js";
import { ASKABLE_FIELDS, missingFields, tripAnalysisSchema } from "@triply/shared";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../db.js";
import { TripModel } from "../models/Trip.js";
import { UserModel } from "../models/User.js";
import { SEED_FIXTURES, type SeedFixture } from "./fixtures.js";

async function seedForUser(email: string): Promise<void> {
  const user = await UserModel.findOne({ email });

  if (!user) {
    console.warn(`[seed] no user with email ${email}; skipping`);
    return;
  }

  let created = 0;
  let updated = 0;

  for (const fixture of SEED_FIXTURES) {
    const existed = await TripModel.exists({
      user: user._id,
      fixtureKey: fixture.fixtureKey,
    });

    await upsertFixture(user._id, fixture);

    if (existed) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  console.log(`[seed] ${email}: ${created} created, ${updated} updated`);
}

async function upsertFixture(
  userId: Types.ObjectId,
  fixture: SeedFixture,
): Promise<void> {
  const analysis = tripAnalysisSchema.parse(fixture.analysis);
  const confirmedFields = ASKABLE_FIELDS.filter(
    (field) => !missingFields(analysis).includes(field),
  );

  await TripModel.findOneAndUpdate(
    { user: userId, fixtureKey: fixture.fixtureKey },
    {
      $set: {
        status: fixture.status,
        prompt: fixture.prompt,
        badges: fixture.badges,
        analysis,
        confirmedFields,
        missingFields: missingFields(analysis, confirmedFields),
        equipment: fixture.equipment,
      },
      $setOnInsert: { user: userId, fixtureKey: fixture.fixtureKey },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).exec();
}

async function main(): Promise<void> {
  const emails = process.argv.slice(2);

  await connectDb(env.MONGODB_URI);
  await seedDestinations();

  if (emails.length === 0) {
    const users = await UserModel.find({}, "email").lean().exec();

    if (users.length === 0) {
      console.log("[seed] no users found; register through the API first");
      return;
    }

    for (const user of users) {
      await seedForUser(user.email);
    }

    return;
  }

  for (const email of emails) {
    await seedForUser(email.toLowerCase());
  }
}

void main()
  .then(async () => {
    await process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("[seed] failed:", error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  });
