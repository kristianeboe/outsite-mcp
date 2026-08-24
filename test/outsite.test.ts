import assert from "node:assert/strict";
import test from "node:test";

import {
  OutsiteClient,
  findOpenWindows,
  parseLocationsFromHtml,
  propertySlugFromInput,
  validateDateRange,
  type CalendarDay,
} from "../src/outsite.js";

test("parses unique Outsite locations from escaped Next.js data", () => {
  const html = String.raw`{\"properties\":[{\"id\":\"at\",\"name\":\"Austin - Bouldin Creek\",\"slug\":\"austin-bouldin-creek\"},{\"id\":\"at2\",\"name\":\"Austin - Travis Heights\",\"slug\":\"austin-travis-heights\"},{\"id\":\"at\",\"name\":\"Austin - Bouldin Creek\",\"slug\":\"austin-bouldin-creek\"}]}`;

  assert.deepEqual(parseLocationsFromHtml(html), [
    {
      id: "at",
      name: "Austin - Bouldin Creek",
      slug: "austin-bouldin-creek",
      url: "https://www.outsite.co/locations/austin-bouldin-creek",
    },
    {
      id: "at2",
      name: "Austin - Travis Heights",
      slug: "austin-travis-heights",
      url: "https://www.outsite.co/locations/austin-travis-heights",
    },
  ]);
});

test("extracts a property slug from localized and dated Outsite URLs", () => {
  assert.equal(
    propertySlugFromInput(
      "https://www.outsite.co/es/locations/austin-travis-heights?startDate=2026-09-01",
    ),
    "austin-travis-heights",
  );
  assert.equal(propertySlugFromInput("todos-santos"), "todos-santos");
  assert.throws(
    () => propertySlugFromInput("https://example.com/locations/austin"),
    /outsite\.co/,
  );
});

test("validates exact stay and calendar ranges", () => {
  assert.equal(validateDateRange("2026-09-01", "2026-09-08", 365, false), 7);
  assert.equal(validateDateRange("2026-09-01", "2026-09-08", 8, true), 7);
  assert.throws(() =>
    validateDateRange("2026-09-08", "2026-09-01", 365, false),
  );
  assert.throws(() =>
    validateDateRange("2026-02-30", "2026-03-02", 365, false),
  );
});

test("collapses consecutive available days into open windows", () => {
  const day = (date: string, available: boolean): CalendarDay => ({
    date,
    available,
    checkInAvailable: available,
    checkoutOnly: false,
    nightsAvailable: available ? 1 : 0,
    nightsAvailableBefore: 0,
    minimumLOS: 2,
  });

  assert.deepEqual(
    findOpenWindows([
      day("2026-09-01", false),
      day("2026-09-02", true),
      day("2026-09-03", true),
      day("2026-09-04", false),
      day("2026-09-05", true),
    ]),
    [
      { startDate: "2026-09-02", endDate: "2026-09-03", nights: 2 },
      { startDate: "2026-09-05", endDate: "2026-09-05", nights: 1 },
    ],
  );
});

test("does not send cookies or authorization to Outsite", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.endsWith("/locations")) {
      return new Response(
        String.raw`{\"id\":\"at2\",\"name\":\"Austin - Travis Heights\",\"slug\":\"austin-travis-heights\"}`,
        { status: 200 },
      );
    }

    return Response.json({
      data: {
        availableRooms: [
          {
            currency: "USD",
            propertyId: "at2",
            rateId: "weekly",
            totalRate: 573.36,
            roomsAvailable: 1,
            roomType: {
              id: "a31da272-3105-5abd-bbde-8b2766df3ad7",
              name: "Woodland",
              description: "Private room",
              bedType: "Queen",
              roomSize: 20,
              maxGuests: 2,
            },
            totalRateBeforeDiscount: 637.06,
            totalRatePerNight: 81.91,
            nights: 7,
            ratePlanNamePublic: "Weekly",
            isMemberRate: true,
            rateName: "Member Weekly Rate",
            cancellationPolicy: { summary: "Flexible" },
          },
        ],
      },
    });
  };

  const client = new OutsiteClient({
    fetch: fetchMock,
    cacheTtlMs: 60_000,
    now: () => new Date("2026-08-23T22:00:00.000Z"),
  });
  const result = await client.searchStays({
    property: "austin-travis-heights",
    startDate: "2026-09-12",
    endDate: "2026-09-19",
    guests: 1,
  });

  assert.equal(result.rates[0]?.roomName, "Woodland");
  assert.equal(result.rates[0]?.totalRate, 573.36);
  const graphRequest = requests.find(({ url }) => url.includes("graphql"));
  assert.ok(graphRequest);
  const headers = new Headers(graphRequest.init?.headers);
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("authorization"), false);
});

test(
  "live anonymous Outsite smoke",
  { skip: process.env.RUN_LIVE !== "1" },
  async () => {
    const client = new OutsiteClient({ cacheTtlMs: 1 });
    const locations = await client.findLocations("Austin", 10);
    assert.ok(
      locations.locations.some(
        (location) => location.slug === "austin-travis-heights",
      ),
    );

    const stays = await client.searchStays({
      property: "austin-travis-heights",
      startDate: "2026-09-12",
      endDate: "2026-09-19",
      guests: 1,
    });
    assert.ok(stays.rates.length > 0);

    const firstRoom = stays.rates[0];
    assert.ok(firstRoom);
    const calendar = await client.getRoomCalendar({
      property: "austin-travis-heights",
      roomTypeId: firstRoom.roomTypeId,
      startDate: "2026-09-01",
      endDate: "2026-10-31",
    });
    assert.ok(calendar.days.length > 0);
  },
);
