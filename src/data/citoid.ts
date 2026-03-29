export type CitoidPrimitive = boolean | number | string;
export type CitoidDataValue = CitoidDataObject | CitoidDataValue[] | CitoidPrimitive;
export type CitoidDataObject = { [key: string]: CitoidDataValue };
type CitoidRequestSource = 'enwiki';
const ENWIKI_CITOID_ENDPOINT = 'https://en.wikipedia.org/api/rest_v1/data/citation/mediawiki/';

type CitoidRequestDetails = {
	query: string;
	requestUrl: string;
	requestSource: CitoidRequestSource;
};

export type CitoidRequestError = Error &
	CitoidRequestDetails & {
		status?: number;
		statusText?: string;
		responseText?: string;
		payload?: unknown;
		cause?: unknown;
	};

/**
 * Check whether a value is a plain object with string keys.
 * @param value - Candidate value.
 * @returns True when the value is an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check whether a value matches the supported Citoid payload shape.
 * @param value - Candidate value.
 * @returns True when the value is a Citoid data object.
 */
function isCitoidDataObject(value: unknown): value is CitoidDataObject {
	return isRecord(value);
}

/**
 * Resolve the Citoid endpoint for the current wiki configuration.
 * @param query - URL or identifier to send to Citoid.
 * @returns Resolved request metadata.
 */
function resolveCitoidRequest(query: string): CitoidRequestDetails {
	const encodedQuery = encodeURIComponent(query);

	return {
		query,
		requestUrl: `${ENWIKI_CITOID_ENDPOINT}${encodedQuery}`,
		requestSource: 'enwiki'
	};
}

/**
 * Create an Error object enriched with Citoid request details.
 * @param message - Error message.
 * @param requestDetails - Request details for the failing Citoid call.
 * @param extra - Additional error properties.
 * @returns Enriched request error object.
 */
function createCitoidRequestError(
	message: string,
	requestDetails: CitoidRequestDetails,
	extra: Partial<Omit<CitoidRequestError, keyof Error | keyof CitoidRequestDetails>> = {}
): CitoidRequestError {
	return Object.assign(new Error(message), requestDetails, extra);
}

/**
 * Extract the first usable Citoid item from an API response.
 * @param payload - Raw API response payload.
 * @returns First Citoid item or null.
 */
function extractCitoidItem(payload: unknown): CitoidDataObject | null {
	if (Array.isArray(payload)) {
		return payload.find((item): item is CitoidDataObject => isCitoidDataObject(item)) ?? null;
	}

	if (!isRecord(payload)) return null;

	const items = payload.items;
	if (Array.isArray(items)) {
		return items.find((item): item is CitoidDataObject => isCitoidDataObject(item)) ?? null;
	}

	return isCitoidDataObject(payload) ? payload : null;
}

/**
 * Fetch raw Citoid data for a URL or supported identifier.
 * @param query - URL or identifier string.
 * @returns First Citoid result item.
 */
export async function fetchCitoidData(query: string): Promise<CitoidDataObject> {
	const requestDetails = resolveCitoidRequest(query);
	// console.info('[Cite Forge][Citoid] Requesting citation data', requestDetails);

	const requestHeaders = {
		accept: 'application/json'
	};
	let response: Response;
	try {
		response = await fetch(requestDetails.requestUrl, {
			headers: requestHeaders
		});
	} catch (cause) {
		const requestError = createCitoidRequestError('Citoid request failed before a response was received', requestDetails, {
			cause
		});
		console.warn('[Cite Forge][Citoid] Request threw before a response was received', requestError);
		throw requestError;
	}

	if (!response.ok) {
		const responseText = await readResponseText(response);

		const requestError = createCitoidRequestError(`Citoid request failed with status ${response.status}`, requestDetails, {
			status: response.status,
			statusText: response.statusText,
			responseText
		});
		console.warn('[Cite Forge][Citoid] Non-OK response', requestError);
		throw requestError;
	}

	const payload = (await response.json()) as unknown;
	const citoidItem = extractCitoidItem(payload);
	if (!citoidItem) {
		const requestError = createCitoidRequestError('Citoid response did not contain a citation record', requestDetails, {
			payload
		});
		console.warn('[Cite Forge][Citoid] Response payload could not be parsed into a citation record', requestError);
		throw requestError;
	}

	return citoidItem;
}

/**
 * Read and truncate response text for diagnostics.
 * @param response - Fetch response to inspect.
 * @returns Up to 1000 characters of response text.
 */
async function readResponseText(response: Response): Promise<string> {
	try {
		return (await response.text()).slice(0, 1000);
	} catch {
		return '';
	}
}
