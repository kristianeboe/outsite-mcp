import { MCPServer } from "mcp-use";
import { z } from "zod";

import {
  OutsiteClient,
  formatLocationSearchText,
  formatRoomCalendarText,
  formatStaySearchText,
} from "./src/outsite.js";

const server = new MCPServer({
  name: "outsite-availability",
  title: "Outsite Availability",
  version: "1.0.0",
  description:
    "Unofficial, read-only research tools for public Outsite locations, room availability, and quoted rates.",
});

const outsite = new OutsiteClient();

const sourceSchema = z.object({
  provider: z.literal("Outsite"),
  fetchedAt: z.string(),
  url: z.string().url(),
  unofficial: z.literal(true),
});

const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  url: z.string().url(),
});

const rateSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  propertySlug: z.string(),
  propertyName: z.string(),
  propertyUrl: z.string().url(),
  roomTypeId: z.string(),
  roomName: z.string(),
  description: z.string().nullable(),
  bedType: z.string().nullable(),
  roomSize: z.number().nullable(),
  maxGuests: z.number().nullable(),
  roomsAvailable: z.number(),
  rateId: z.string().nullable(),
  rateName: z.string().nullable(),
  ratePlanName: z.string().nullable(),
  isMemberRate: z.boolean().nullable(),
  currency: z.string(),
  totalRate: z.number(),
  totalRateBeforeDiscount: z.number().nullable(),
  totalRatePerNight: z.number(),
  nights: z.number(),
  cancellationSummary: z.string().nullable(),
  bookingUrl: z.string().url(),
});

const calendarDaySchema = z.object({
  date: z.string(),
  available: z.boolean(),
  checkInAvailable: z.boolean(),
  checkoutOnly: z.boolean(),
  nightsAvailable: z.number(),
  nightsAvailableBefore: z.number(),
  minimumLOS: z.number(),
});

export const findLocations = server.tool(
  {
    name: "find_outsite_locations",
    title: "Find Outsite locations",
    description:
      "Use this when the user names a city, country, neighborhood, or Outsite house and you need the canonical Outsite location slug before searching dates.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(120)
        .describe(
          "Location text such as Austin, Mexico City, Todos Santos, or Travis Heights.",
        ),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    outputSchema: z.object({
      query: z.string(),
      locations: z.array(locationSchema),
      source: sourceSchema,
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  async ({ query, limit }) => {
    try {
      const result = await outsite.findLocations(query, limit);
      return {
        content: [{ type: "text", text: formatLocationSearchText(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

export const searchStays = server.tool(
  {
    name: "search_outsite_stays",
    title: "Search Outsite stays",
    description:
      "Use this when the user wants current room options and quoted public rates for one Outsite location and an exact check-in/check-out period. Call find_outsite_locations first when the slug is unknown.",
    inputSchema: z.object({
      property: z
        .string()
        .min(1)
        .max(240)
        .describe("An Outsite location slug or full Outsite location URL."),
      startDate: z.string().describe("Check-in date in YYYY-MM-DD format."),
      endDate: z.string().describe("Check-out date in YYYY-MM-DD format."),
      guests: z.number().int().min(1).max(12).default(1),
      includeUnavailable: z.boolean().default(false),
    }),
    outputSchema: z.object({
      property: locationSchema,
      startDate: z.string(),
      endDate: z.string(),
      guests: z.number(),
      nights: z.number(),
      rates: z.array(rateSchema),
      unavailableRoomTypes: z.array(
        z.object({
          roomTypeId: z.string(),
          roomName: z.string(),
          description: z.string().nullable(),
          bedType: z.string().nullable(),
          roomSize: z.number().nullable(),
          maxGuests: z.number().nullable(),
        }),
      ),
      source: sourceSchema,
      caveat: z.string(),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  async ({ property, startDate, endDate, guests, includeUnavailable }) => {
    try {
      const result = await outsite.searchStays({
        property,
        startDate,
        endDate,
        guests,
        includeUnavailable,
      });
      return {
        content: [{ type: "text", text: formatStaySearchText(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

export const getRoomCalendar = server.tool(
  {
    name: "get_outsite_room_calendar",
    title: "Get an Outsite room calendar",
    description:
      "Use this after search_outsite_stays when the user wants to inspect the wider individual-room calendar, find contiguous open periods, or compare alternative dates for a specific room type.",
    inputSchema: z.object({
      property: z
        .string()
        .min(1)
        .max(240)
        .describe("An Outsite location slug or full Outsite location URL."),
      roomTypeId: z
        .string()
        .uuid()
        .describe("Room type ID returned by search_outsite_stays."),
      startDate: z
        .string()
        .describe("First calendar date in YYYY-MM-DD format."),
      endDate: z
        .string()
        .describe("Last calendar date in YYYY-MM-DD format, inclusive."),
    }),
    outputSchema: z.object({
      property: locationSchema,
      roomTypeId: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      minimumLOS: z.number(),
      daysInAdvance: z.number(),
      days: z.array(calendarDaySchema),
      openWindows: z.array(
        z.object({
          startDate: z.string(),
          endDate: z.string(),
          nights: z.number(),
        }),
      ),
      source: sourceSchema,
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  async ({ property, roomTypeId, startDate, endDate }) => {
    try {
      const result = await outsite.getRoomCalendar({
        property,
        roomTypeId,
        startDate,
        endDate,
      });
      return {
        content: [{ type: "text", text: formatRoomCalendarText(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return toolError(error);
    }
  },
);

server.get("/health", (context) =>
  context.json({
    status: "ok",
    server: "outsite-availability",
    version: "1.0.0",
    readOnly: true,
  }),
);

function toolError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Unexpected Outsite research error.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

export default server;
