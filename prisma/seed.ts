import { PrismaClient, EventDay } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DAYS: EventDay[] = [EventDay.DEC_24, EventDay.DEC_25, EventDay.DEC_26];
const SEATS_PER_DAY = 50;

async function seedSeats() {
  for (const day of DAYS) {
    for (let seatNumber = 1; seatNumber <= SEATS_PER_DAY; seatNumber++) {
      await prisma.seat.upsert({
        where: { day_seatNumber: { day, seatNumber } },
        update: {},
        create: { day, seatNumber },
      });
    }
  }
  console.log(`Seeded ${DAYS.length * SEATS_PER_DAY} seats.`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn(
      "ADMIN_EMAIL / ADMIN_PASSWORD not set - skipping admin user seed. " +
        "Set them in .env and re-run `npm run seed` to create/update the admin login.",
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });
  console.log(`Seeded admin user ${email}.`);
}

async function main() {
  await seedSeats();
  await seedAdmin();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
