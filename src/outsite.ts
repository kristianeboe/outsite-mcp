const OUTSITE_ORIGIN = "https://www.outsite.co";
const LOCATION_INDEX_URL = `${OUTSITE_ORIGIN}/locations`;
const DEFAULT_GRAPHQL_URL = "https://api.outsite.co/graphql";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_SEARCH_NIGHTS = 365;
const MAX_CALENDAR_DAYS = 180;

const AVAILABLE_ROOMS_QUERY = `
query availableRooms($filters: AvailableRoomsFilters!) {
  availableRooms(filters: $filters) {
    currency propertyId rateId totalRate roomsAvailable isUniqueRoomType roomSize
    roomType {
      id name description roomType bedType photos availableOnline maxGuests
      rates { nightly weekly monthly extended __typename }
      roomSize __typename
    }
    totalRateBeforeDiscount totalRatePerNight relativeAdjustment
    membershipUpsell { savings yearlyMembershipFee rateName __typename }
    nights guests ratePlanNamePublic isMemberRate promoRateId promoRateBookBy
    rateName rateDescription
    cancellationPolicy { id summary __typename }
    __typename
  }
}
`;

const ROOM_CALENDAR_QUERY = `
query getRoomTypeAvailability($propertyId: String!, $roomTypeId: String!) {
  availability(propertyId: $propertyId, roomTypeId: $roomTypeId) {
    days {
      date available checkInAvailable nightsAvailable checkoutOnly
      nightsAvailableBefore minimumLOS __typename
    }
    daysInAdvance minimumLOS __typename
  }
}
`;

export interface Location {
  id: string;
  name: string;
  slug: string;
  url: string;
}

export interface Source {
  provider: "Outsite";
  fetchedAt: string;
  url: string;
  unofficial: true;
}

export interface LocationSearchResult {
  query: string;
  locations: Location[];
  source: Source;
}

export interface StayRate {
  id: string;
  propertyId: string;
  propertySlug: string;
  propertyName: string;
  propertyUrl: string;
  roomTypeId: string;
  roomName: string;
  description: string | null;
  bedType: string | null;
  roomSize: number | null;
  maxGuests: number | null;
  roomsAvailable: number;
  rateId: string | null;
  rateName: string | null;
  ratePlanName: string | null;
  isMemberRate: boolean | null;
  currency: string;
  totalRate: number;
  totalRateBeforeDiscount: number | null;
  totalRatePerNight: number;
  nights: number;
  cancellationSummary: string | null;
  bookingUrl: string;
}

export interface UnavailableRoomType {
  roomTypeId: string;
  roomName: string;
  description: string | null;
  bedType: string | null;
  roomSize: number | null;
  maxGuests: number | null;
}

export interface StaySearchResult {
  property: Location;
  startDate: string;
  endDate: string;
  guests: number;
  nights: number;
  member: boolean | null;
  rates: StayRate[];
  unavailableRoomTypes: UnavailableRoomType[];
  source: Source;
  caveat: string;
}

export interface CalendarDay {
  date: string;
  available: boolean;
  checkInAvailable: boolean;
  checkoutOnly: boolean;
  nightsAvailable: number;
  nightsAvailableBefore: number;
  minimumLOS: number;
}

export interface OpenWindow {
  startDate: string;
  endDate: string;
  nights: number;
}

export interface RoomCalendarResult {
  property: Location;
  roomTypeId: string;
  startDate: string;
  endDate: string;
  minimumLOS: number;
  daysInAdvance: number;
  days: CalendarDay[];
  openWindows: OpenWindow[];
  source: Source;
}

interface OutsiteClientOptions {
  fetch?: typeof fetch;
  graphqlUrl?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  now?: () => Date;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface RawRoomType {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  bedType?: unknown;
  roomSize?: unknown;
  maxGuests?: unknown;
}

interface RawAvailableRoom {
  currency?: unknown;
  propertyId?: unknown;
  rateId?: unknown;
  totalRate?: unknown;
  roomsAvailable?: unknown;
  roomType?: RawRoomType;
  totalRateBeforeDiscount?: unknown;
  totalRatePerNight?: unknown;
  nights?: unknown;
  ratePlanNamePublic?: unknown;
  isMemberRate?: unknown;
  rateName?: unknown;
  cancellationPolicy?: { summary?: unknown } | null;
}

interface RawCalendarDay {
  date?: unknown;
  available?: unknown;
  checkInAvailable?: unknown;
  nightsAvailable?: unknown;
  checkoutOnly?: unknown;
  nightsAvailableBefore?: unknown;
  minimumLOS?: unknown;
}

export class OutsiteClient {
  private readonly fetchImpl: typeof fetch;
  private readonly graphqlUrl: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(options: OutsiteClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.graphqlUrl =
      options.graphqlUrl ??
      process.env.OUTSITE_GRAPHQL_URL ??
      DEFAULT_GRAPHQL_URL;
    this.cacheTtlMs =
      options.cacheTtlMs ??
      numberFromEnv("OUTSITE_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
    this.timeoutMs =
      options.timeoutMs ??
      numberFromEnv("OUTSITE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    this.now = options.now ?? (() => new Date());
  }

  async findLocations(
    query: string,
    limit = 10,
  ): Promise<LocationSearchResult> {
    const locations = await this.listLocations();
    const normalizedQuery = normalizeSearchText(query);

    const ranked = locations
      .map((location) => ({
        location,
        score: scoreLocation(location, normalizedQuery),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.location.name.localeCompare(right.location.name),
      )
      .slice(0, limit)
      .map(({ location }) => location);

    return {
      query,
      locations: ranked,
      source: this.source(LOCATION_INDEX_URL),
    };
  }

  async searchStays(input: {
    property: string;
    startDate: string;
    endDate: string;
    guests?: number;
    member?: boolean;
    includeUnavailable?: boolean;
  }): Promise<StaySearchResult> {
    const property = await this.resolveProperty(input.property);
    const nights = validateDateRange(
      input.startDate,
      input.endDate,
      MAX_SEARCH_NIGHTS,
      false,
    );
    const guests = input.guests ?? 1;
    const bookingUrl = buildPropertyUrl(
      property.slug,
      input.startDate,
      input.endDate,
    );
    const cacheKey = `stays:${property.id}:${input.startDate}:${input.endDate}:${guests}`;

    const rows = await this.cached(cacheKey, () =>
      this.graphql<RawAvailableRoom[]>(
        AVAILABLE_ROOMS_QUERY,
        {
          filters: {
            propertyId: property.id,
            startDate: input.startDate,
            endDate: input.endDate,
            guests,
          },
        },
        "availableRooms",
      ),
    );

    if (!Array.isArray(rows))
      throw new Error("Outsite changed its availableRooms response shape.");

    const rates: StayRate[] = [];
    const unavailable = new Map<string, UnavailableRoomType>();

    for (const row of rows) {
      const roomType = parseRoomType(row.roomType);
      const roomsAvailable = requiredNumber(
        row.roomsAvailable,
        "roomsAvailable",
      );
      const totalRate = optionalNumber(row.totalRate);
      const totalRatePerNight = optionalNumber(row.totalRatePerNight);

      if (
        roomsAvailable <= 0 ||
        totalRate === null ||
        totalRatePerNight === null
      ) {
        unavailable.set(roomType.roomTypeId, roomType);
        continue;
      }

      const rate: StayRate = {
        id: `${property.id}:${roomType.roomTypeId}:${optionalString(row.rateId) ?? optionalString(row.rateName) ?? "rate"}`,
        propertyId: property.id,
        propertySlug: property.slug,
        propertyName: property.name,
        propertyUrl: property.url,
        roomTypeId: roomType.roomTypeId,
        roomName: roomType.roomName,
        description: roomType.description,
        bedType: roomType.bedType,
        roomSize: roomType.roomSize,
        maxGuests: roomType.maxGuests,
        roomsAvailable,
        rateId: optionalString(row.rateId),
        rateName: optionalString(row.rateName),
        ratePlanName: optionalString(row.ratePlanNamePublic),
        isMemberRate: optionalBoolean(row.isMemberRate),
        currency: requiredString(row.currency, "currency"),
        totalRate,
        totalRateBeforeDiscount: optionalNumber(row.totalRateBeforeDiscount),
        totalRatePerNight,
        nights: optionalNumber(row.nights) ?? nights,
        cancellationSummary: optionalString(row.cancellationPolicy?.summary),
        bookingUrl,
      };

      if (input.member === undefined || rate.isMemberRate === input.member) {
        rates.push(rate);
      }
    }

    rates.sort(
      (left, right) =>
        left.totalRate - right.totalRate ||
        left.roomName.localeCompare(right.roomName),
    );

    return {
      property,
      startDate: input.startDate,
      endDate: input.endDate,
      guests,
      nights,
      member: input.member ?? null,
      rates,
      unavailableRoomTypes: input.includeUnavailable
        ? [...unavailable.values()]
        : [],
      source: this.source(bookingUrl),
      caveat:
        "Outsite's member label does not establish eligibility. Guest rates, member rates, and promotions can appear in any price order, so leave member unset when comparing the cheapest public rate. Confirm the final rate on Outsite before booking.",
    };
  }

  async getRoomCalendar(input: {
    property: string;
    roomTypeId: string;
    startDate: string;
    endDate: string;
  }): Promise<RoomCalendarResult> {
    const property = await this.resolveProperty(input.property);
    validateDateRange(input.startDate, input.endDate, MAX_CALENDAR_DAYS, true);
    const cacheKey = `calendar:${property.id}:${input.roomTypeId}`;
    const availability = await this.cached(cacheKey, () =>
      this.graphql<{
        days?: RawCalendarDay[];
        daysInAdvance?: unknown;
        minimumLOS?: unknown;
      }>(
        ROOM_CALENDAR_QUERY,
        { propertyId: property.id, roomTypeId: input.roomTypeId },
        "availability",
      ),
    );

    if (!availability || !Array.isArray(availability.days)) {
      throw new Error("Outsite changed its room calendar response shape.");
    }

    const days = availability.days
      .map(parseCalendarDay)
      .filter(
        (day) => day.date >= input.startDate && day.date <= input.endDate,
      );

    return {
      property,
      roomTypeId: input.roomTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      minimumLOS: requiredNumber(availability.minimumLOS, "minimumLOS"),
      daysInAdvance: requiredNumber(
        availability.daysInAdvance,
        "daysInAdvance",
      ),
      days,
      openWindows: findOpenWindows(days),
      source: this.source(property.url),
    };
  }

  async listLocations(): Promise<Location[]> {
    return this.cached("locations", async () =>
      parseLocationsFromHtml(await this.fetchText(LOCATION_INDEX_URL)),
    );
  }

  private async resolveProperty(value: string): Promise<Location> {
    const slug = propertySlugFromInput(value);
    const property = (await this.listLocations()).find(
      (location) => location.slug === slug,
    );
    if (!property)
      throw new Error(
        `No public Outsite location matched "${slug}". Call find_outsite_locations first.`,
      );
    return property;
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    field: string,
  ): Promise<T> {
    const response = await this.fetchWithTimeout(this.graphqlUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent":
          "outsite-mcp/1.0 (+https://github.com/kristianeboe/outsite-mcp)",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok)
      throw new Error(`Outsite GraphQL returned HTTP ${response.status}.`);

    const payload = (await response.json()) as {
      data?: Record<string, unknown>;
      errors?: Array<{ message?: string }>;
    };
    if (payload.errors?.length) {
      const message = payload.errors
        .map((error) => error.message ?? "Unknown GraphQL error")
        .join("; ");
      throw new Error(`Outsite GraphQL error: ${message}`);
    }
    if (!payload.data || !(field in payload.data))
      throw new Error(`Outsite GraphQL response omitted ${field}.`);
    return payload.data[field] as T;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchWithTimeout(url, {
      headers: {
        accept: "text/html",
        "user-agent":
          "outsite-mcp/1.0 (+https://github.com/kristianeboe/outsite-mcp)",
      },
    });
    if (!response.ok)
      throw new Error(`Outsite returned HTTP ${response.status} for ${url}.`);
    return response.text();
  }

  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Outsite did not respond within ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.now().getTime();
    const existing = this.cache.get(key) as CacheEntry<T> | undefined;
    if (existing && existing.expiresAt > now) return existing.value;
    const value = await load();
    this.cache.set(key, { expiresAt: now + this.cacheTtlMs, value });
    return value;
  }

  private source(url: string): Source {
    return {
      provider: "Outsite",
      fetchedAt: this.now().toISOString(),
      url,
      unofficial: true,
    };
  }
}

export function parseLocationsFromHtml(html: string): Location[] {
  const normalized = html.replaceAll('\\"', '"');
  const pattern = /"id":"([^"]+)","name":"((?:\\.|[^"])*)","slug":"([^"]+)"/g;
  const locations = new Map<string, Location>();
  for (const match of normalized.matchAll(pattern)) {
    const [, id, rawName, slug] = match;
    if (!id || !rawName || !slug || locations.has(id)) continue;
    locations.set(id, {
      id,
      name: decodeJsonString(rawName),
      slug,
      url: `${OUTSITE_ORIGIN}/locations/${slug}`,
    });
  }
  if (locations.size === 0)
    throw new Error("Outsite changed its public locations page shape.");
  return [...locations.values()];
}

export function propertySlugFromInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("An Outsite property slug or URL is required.");
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.hostname !== "www.outsite.co" && url.hostname !== "outsite.co") {
      throw new Error("Property URLs must use outsite.co.");
    }
    const match = url.pathname.match(/\/(?:[a-z]{2}\/)?locations\/([^/]+)/i);
    if (!match?.[1])
      throw new Error("The Outsite URL does not contain a location slug.");
    return decodeURIComponent(match[1]).toLowerCase();
  }
  return trimmed.toLowerCase().replace(/^\/+|\/+$/g, "");
}

export function validateDateRange(
  startDate: string,
  endDate: string,
  maxDays: number,
  inclusiveEnd: boolean,
): number {
  const start = parseIsoDate(startDate, "startDate");
  const end = parseIsoDate(endDate, "endDate");
  const difference = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (difference < 1) throw new Error("endDate must be after startDate.");
  const selectedDays = inclusiveEnd ? difference + 1 : difference;
  if (selectedDays > maxDays)
    throw new Error(`The date range may not exceed ${maxDays} days.`);
  return difference;
}

export function findOpenWindows(days: CalendarDay[]): OpenWindow[] {
  const windows: OpenWindow[] = [];
  let start: CalendarDay | undefined;
  let previous: CalendarDay | undefined;
  const flush = () => {
    if (!start || !previous) return;
    const nights =
      Math.round(
        (parseIsoDate(previous.date, "calendar date").getTime() -
          parseIsoDate(start.date, "calendar date").getTime()) /
          86_400_000,
      ) + 1;
    windows.push({ startDate: start.date, endDate: previous.date, nights });
    start = undefined;
    previous = undefined;
  };
  for (const day of days) {
    if (!day.available) {
      flush();
      continue;
    }
    if (previous && nextIsoDate(previous.date) !== day.date) flush();
    start ??= day;
    previous = day;
  }
  flush();
  return windows;
}

export function formatLocationSearchText(result: LocationSearchResult): string {
  if (result.locations.length === 0)
    return `No Outsite locations matched "${result.query}". Data checked ${result.source.fetchedAt}.`;
  const lines = result.locations.map(
    (location) => `- ${location.name}: ${location.slug} (${location.url})`,
  );
  return [
    `Found ${result.locations.length} Outsite location(s):`,
    ...lines,
    `Checked ${result.source.fetchedAt}.`,
  ].join("\n");
}

export function formatStaySearchText(result: StaySearchResult): string {
  const filterLabel =
    result.member === true
      ? "member"
      : result.member === false
        ? "guest or non-member"
        : "public";
  if (result.rates.length === 0)
    return `No currently available ${filterLabel} rate was returned for ${result.property.name}, ${result.startDate} to ${result.endDate}. Checked ${result.source.fetchedAt}.`;
  const lines = result.rates.map((rate) => {
    const label = rate.rateName ?? rate.ratePlanName ?? "Public rate";
    return `- ${rate.roomName}: ${formatMoney(rate.totalRate, rate.currency)} total (${formatMoney(rate.totalRatePerNight, rate.currency)}/night), ${label}, ${rate.roomsAvailable} available`;
  });
  return [
    `${result.property.name}: ${result.startDate} to ${result.endDate} (${result.nights} nights)`,
    `Rate filter: ${filterLabel}`,
    ...lines,
    `Checked ${result.source.fetchedAt}. Rates can change; confirm on Outsite before booking.`,
  ].join("\n");
}

export function formatRoomCalendarText(result: RoomCalendarResult): string {
  const windows = result.openWindows.length
    ? result.openWindows
        .map(
          (window) =>
            `- ${window.startDate} through ${window.endDate}: ${window.nights} calendar day(s) open`,
        )
        .join("\n")
    : "- No open window in the requested range.";
  return [
    `${result.property.name} room calendar, ${result.startDate} through ${result.endDate}`,
    `Minimum stay: ${result.minimumLOS} nights`,
    windows,
    `Checked ${result.source.fetchedAt}.`,
  ].join("\n");
}

function parseRoomType(value: RawRoomType | undefined): UnavailableRoomType {
  if (!value)
    throw new Error("Outsite returned a rate without roomType details.");
  return {
    roomTypeId: requiredString(value.id, "roomType.id"),
    roomName: requiredString(value.name, "roomType.name"),
    description: optionalString(value.description),
    bedType: optionalString(value.bedType),
    roomSize: optionalNumber(value.roomSize),
    maxGuests: optionalNumber(value.maxGuests),
  };
}

function parseCalendarDay(value: RawCalendarDay): CalendarDay {
  return {
    date: requiredString(value.date, "availability.days.date"),
    available: requiredBoolean(value.available, "availability.days.available"),
    checkInAvailable: requiredBoolean(
      value.checkInAvailable,
      "availability.days.checkInAvailable",
    ),
    checkoutOnly: requiredBoolean(
      value.checkoutOnly,
      "availability.days.checkoutOnly",
    ),
    nightsAvailable: requiredNumber(
      value.nightsAvailable,
      "availability.days.nightsAvailable",
    ),
    nightsAvailableBefore: requiredNumber(
      value.nightsAvailableBefore,
      "availability.days.nightsAvailableBefore",
    ),
    minimumLOS: requiredNumber(
      value.minimumLOS,
      "availability.days.minimumLOS",
    ),
  };
}

function buildPropertyUrl(
  slug: string,
  startDate?: string,
  endDate?: string,
): string {
  const url = new URL(`${OUTSITE_ORIGIN}/locations/${slug}`);
  if (startDate) url.searchParams.set("startDate", startDate);
  if (endDate) url.searchParams.set("endDate", endDate);
  return url.toString();
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreLocation(location: Location, query: string): number {
  if (!query) return 0;
  const name = normalizeSearchText(location.name);
  const slug = normalizeSearchText(location.slug);
  if (name === query || slug === query) return 100;
  if (name.startsWith(query) || slug.startsWith(query)) return 80;
  if (name.includes(query) || slug.includes(query)) return 60;
  const tokens = query.split(" ").filter(Boolean);
  const matchingTokens = tokens.filter(
    (token) => name.includes(token) || slug.includes(token),
  );
  return matchingTokens.length === tokens.length
    ? 40 + matchingTokens.length
    : 0;
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function parseIsoDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`${field} must use YYYY-MM-DD format.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error(`${field} is not a valid calendar date.`);
  return date;
}

function nextIsoDate(value: string): string {
  const date = parseIsoDate(value, "calendar date");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Outsite changed ${field}; expected a non-empty string.`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Outsite changed ${field}; expected a number.`);
  return value;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`Outsite changed ${field}; expected a boolean.`);
  return value;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
