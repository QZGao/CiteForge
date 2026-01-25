import { getTemplateAliasMap, getTemplateParamOrder } from "../data/templatedata_fetch";
import { convertDigitsToAscii, escapeAttr, extractAttr, MONTH_NAME_MAP } from "./string_utils";
import {
	parseRTemplateEntries,
	parseTemplateParams,
	parseWikitext,
	ReferencesTagMatch,
	refIterator,
	refKey,
	RefKey,
	RefRecord,
	RefUseInternal,
	RTemplateEntry,
	splitTemplateParams,
	TemplateMatch,
	TemplateParam
} from "./parse_wikitext";

/**
 * Get the first non-empty content from a reference's definitions or ldrDefinitions.
 * @param ref - Reference record to extract content from.
 * @returns The first non-empty content string or null if none found.
 */
function firstContent(ref: RefRecord): string | null {
	if (typeof ref.contentOverride === 'string') {
		return ref.contentOverride;
	}
	const def = ref.definitions.find((d) => (d.content || '').trim().length > 0) || ref.ldrDefinitions.find((d) => (d.content || '').trim().length > 0);
	return def?.content ?? null;
}

/**
 * Plan replacements for refs and reflist templates.
 * @param ctx - Parsing context with refs and templates.
 * @param opts - Options for replacement behavior.
 * @returns Replacement plan with text changes and moved refs.
 */
function buildReplacementPlan(ctx: {
	refs: Map<RefKey, RefRecord>;
	templates: TemplateMatch[];
	referencesTags: ReferencesTagMatch[];
	rTemplates: Array<{ id: number; start: number; end: number; entries: RTemplateEntry[] }>
}, opts: {
	preferTemplateR: boolean;
	preferTemplateReflist: boolean;
	sortRefs: boolean;
	normalizeAll: boolean;
	locationModeKeep: boolean;
	renameLookup?: (name: string) => string | null | undefined;
	contentOverrideLookup?: (ref: RefRecord) => string | undefined;
}): { replacements: Replacement[]; movedInline: string[]; movedLdr: string[] } {
	const replacements: Replacement[] = [];
	const movedInline: string[] = [];
	const movedLdr: string[] = [];

	const canonicalMap = new Map<RefRecord, RefRecord>();
	refIterator(ctx.refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		canonicalMap.set(ref, canonical);
	});

	// Replace chained {{r}} templates preserving names
	ctx.rTemplates.forEach((tpl) => {
		const rendered = renderRTemplate(tpl, ctx.refs, opts.preferTemplateR, opts.renameLookup);
		if (rendered !== null) {
			replacements.push({ start: tpl.start, end: tpl.end, text: rendered });
		}
	});

	// Build replacements for individual refs
	refIterator(ctx.refs).forEach((ref) => {
		const canonical = canonicalMap.get(ref) ?? ref;
		const targetName = canonical.name ?? ref.name;
		const targetLocation = canonical.targetLocation;
		const overrideContent = opts.contentOverrideLookup?.(canonical);
		const content = overrideContent !== undefined ? overrideContent : firstContent(canonical);

		// Uses (including ones tied to definitions)
		ref.uses.forEach((use, useIdx) => {
			if (use.kind === 'templateR' && typeof use.rTemplateId === 'number') {
				// Already handled via rTemplates replacement
				return;
			}
			const isDefinition = ref.definitions.includes(use);
			const canonicalContent = content || '';
			if (
				opts.locationModeKeep &&
				!opts.preferTemplateR &&
				!opts.normalizeAll &&
				targetName === use.name &&
				ref.group === use.group &&
				((use.kind === 'full' && canonicalContent === use.content) || use.kind !== 'full')
			) {
				return;
			}
			if (targetLocation === 'inline' && canonical === ref && useIdx === 0 && canonicalContent) {
				// Ensure first use holds definition
				const rendered = renderRefTag(targetName, ref.group, canonicalContent, opts.normalizeAll);
				replacements.push({ start: use.start, end: use.end, text: rendered });
				if (targetName) movedInline.push(targetName);
			} else {
				const rendered = renderRefSelf(targetName, ref.group, opts.preferTemplateR);
				replacements.push({ start: use.start, end: use.end, text: rendered });
			}
			if (isDefinition && targetLocation === 'ldr' && targetName) {
				movedLdr.push(targetName);
			}
		});

		if (opts.locationModeKeep && ref.ldrDefinitions.length > 0) {
			ref.ldrDefinitions.forEach((def) => {
				const override = opts.contentOverrideLookup?.(canonical);
				const content = override !== undefined ? override : def.content ?? '';
				const targetGroup = def.group ?? ref.group;
				if (!opts.preferTemplateR && !opts.normalizeAll && targetName === def.name && targetGroup === def.group) {
					if (override === undefined) {
						return;
					}
				}
				const rendered = content
					? renderRefTag(targetName, targetGroup, content, opts.normalizeAll)
					: renderRefSelf(targetName, targetGroup, opts.preferTemplateR);
				replacements.push({ start: def.start, end: def.end, text: rendered });
				if (targetName) movedLdr.push(targetName);
			});
		}
	});

	// Rebuild reflist templates
	if (!opts.locationModeKeep) {
		const ldrEntries = buildLdrEntries(ctx.refs, opts.contentOverrideLookup);
		const entriesByGroup = groupEntriesByGroup(ldrEntries);
		const getEntries = (group: string | null): Array<{ name: string; group: string | null; content: string }> =>
			entriesByGroup.get(normalizeGroupValue(group)) ?? [];
		const containerGroups = new Set<string | null>();
		const hasReferencesTags = ctx.referencesTags.length > 0;
		const hasGroupedReferencesTags = ctx.referencesTags.some((tag) => {
			const group = normalizeGroupValue(extractAttr(tag.attrs ?? '', 'group'));
			return group !== null;
		});
		ctx.templates.forEach((tpl) => {
			const referencesGroup = !opts.preferTemplateReflist ? getConvertibleReflistGroup(tpl.params) : undefined;
			const templateGroup = normalizeGroupValue(getTemplateGroup(tpl.params));
			containerGroups.add(templateGroup);
			const groupEntries = getEntries(referencesGroup ?? templateGroup);
			const updated = referencesGroup !== undefined
				? buildReferencesTag(groupEntries, opts.sortRefs, referencesGroup)
				: updateReflistTemplate(tpl, groupEntries, opts.sortRefs);
			if (updated !== tpl.content) {
				replacements.push({ start: tpl.start, end: tpl.end, text: updated });
			}
		});
		ctx.referencesTags.forEach((tag) => {
			const tagGroup = normalizeGroupValue(extractAttr(tag.attrs ?? '', 'group'));
			containerGroups.add(tagGroup);
			const allowConversion = opts.preferTemplateReflist && !hasGroupedReferencesTags;
			const reflistGroup = allowConversion ? getConvertibleReferencesGroup(tag.attrs) : undefined;
			const updated = reflistGroup !== undefined
				? buildReflistTemplate(getEntries(reflistGroup), opts.sortRefs, reflistGroup)
				: updateReferencesTag(tag, getEntries(tagGroup), opts.sortRefs);
			if (updated !== tag.content) {
				replacements.push({ start: tag.start, end: tag.end, text: updated });
			}
		});

		// Append containers for any missing groups
		if (ldrEntries.length > 0) {
			const preferTemplate = opts.preferTemplateReflist && !hasReferencesTags;
			entriesByGroup.forEach((entries, group) => {
				if (containerGroups.has(group)) return;
				const appendText = preferTemplate
					? buildStandaloneReflist(entries, opts.sortRefs, group)
					: buildStandaloneReferences(entries, opts.sortRefs, group);
				replacements.push({ start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER, text: appendText });
			});
		}
	}

	// De-duplicate overlapping replacements by keeping last
	const collapsed = collapseReplacements(replacements);

	return { replacements: collapsed, movedInline, movedLdr };
}

/**
 * Build list of LDR entries from references.
 * @param refs - Map of reference records.
 * @param contentOverrideLookup - Optional function to override content per reference.
 * @returns Array of LDR entries with name, group, and content.
 */
function buildLdrEntries(
	refs: Map<RefKey, RefRecord>,
	contentOverrideLookup?: (ref: RefRecord) => string | undefined
): Array<{ name: string; group: string | null; content: string }> {
	const list: Array<{ name: string; group: string | null; content: string }> = [];
	refIterator(refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		if (canonical !== ref) return;
		if (canonical.targetLocation !== 'ldr') return;
		if (!canonical.name) return;
		const override = contentOverrideLookup?.(canonical);
		const content = override !== undefined ? override : firstContent(canonical);
		if (!content) return;
		list.push({ name: canonical.name, group: canonical.group, content });
	});
	return list;
}

/**
 * Normalize a group value for matching and rendering.
 * @param group - Raw group value.
 * @returns Normalized group value or null.
 */
function normalizeGroupValue(group: string | null | undefined): string | null {
	if (!group) return null;
	const trimmed = group.trim();
	return trimmed.length ? trimmed : null;
}

/**
 * Group LDR entries by group name.
 * @param entries - List-defined reference entries.
 * @returns Map of group names to entries.
 */
function groupEntriesByGroup(entries: Array<{
	name: string; group: string | null; content: string
}>): Map<string | null, Array<{ name: string; group: string | null; content: string }>> {
	const grouped = new Map<string | null, Array<{ name: string; group: string | null; content: string }>>();
	entries.forEach((entry) => {
		const group = normalizeGroupValue(entry.group);
		const bucket = grouped.get(group) ?? [];
		bucket.push({ ...entry, group });
		grouped.set(group, bucket);
	});
	return grouped;
}

/**
 * Extract a group value from template params.
 * @param params - Template parameters.
 * @returns Group value or null if not present.
 */
function getTemplateGroup(params: TemplateParam[]): string | null {
	for (const param of params) {
		if (!param.name) continue;
		if (param.name.trim().toLowerCase() !== 'group') continue;
		const trimmed = (param.value ?? '').trim();
		return trimmed.length ? trimmed : null;
	}
	return null;
}

/**
 * Render a self-closing reference tag or template.
 * @param name - Reference name.
 * @param group - Reference group.
 * @param preferTemplateR - Whether to prefer the {{r|...}} template format.
 * @returns Rendered reference string.
 */
function renderRefSelf(name: string | null, group: string | null, preferTemplateR: boolean): string {
	if (!name) {
		// Fall back to empty self-closing tag
		return '<ref />';
	}
	if (preferTemplateR) {
		const parts = [`${name}`];
		if (group) parts.push(`group=${escapeAttr(group)}`);
		return `{{r|${parts.join('|')}}}`;
	}
	const attrs = [`name="${escapeAttr(name)}"`];
	if (group) attrs.push(`group="${escapeAttr(group)}"`);
	return `<ref ${attrs.join(' ')} />`;
}

/**
 * Render a full reference tag with content.
 * @param name - Reference name.
 * @param group - Reference group.
 * @param content - Reference content.
 * @param normalize - Whether to normalize the content body.
 * @returns Rendered full reference tag string.
 */
function renderRefTag(name: string | null, group: string | null, content: string, normalize = false): string {
	const attrs: string[] = [];
	if (name) attrs.push(`name="${escapeAttr(name)}"`);
	if (group) attrs.push(`group="${escapeAttr(group)}"`);
	const inner = normalize ? normalizeRefBody(content) : normalizeContentBlock(content);
	return `<ref${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</ref>`;
}

/**
 * Pad a date part with leading zero if needed.
 * @param value - Numeric date part.
 * @returns Padded date part as string.
 */
function padDatePart(value: number): string {
	return value.toString().padStart(2, '0');
}

/**
 * Build an ISO date string from year, month, and day.
 * @param year - Full year.
 * @param month - Month (1-12).
 * @param day - Day (1-31).
 * @returns ISO date string or null if invalid.
 */
function buildIsoDate(year: number, month: number, day: number): string | null {
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
	return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

/**
 * Normalize a raw date value into ISO format (yyyy-mm-dd).
 * @param rawValue - Raw date string.
 * @returns Normalized ISO date string or null if unrecognized.
 */
function normalizeDateValue(rawValue: string): string | null {
	if (!rawValue) return null;
	const trimmed = convertDigitsToAscii(rawValue).trim();
	if (!trimmed) return null;
	if (/[\{\}\[\]]/.test(trimmed)) return null;

	const ymd = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
	if (ymd) {
		const [, y, m, d] = ymd;
		return buildIsoDate(Number(y), Number(m), Number(d));
	}

	const zh = trimmed.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/);
	if (zh) {
		const [, y, m, d] = zh;
		return buildIsoDate(Number(y), Number(m), Number(d));
	}

	const dayMonth = trimmed.match(/^(\d{1,2})\s+([A-Za-z.]+)\s*,?\s*(\d{4})$/);
	if (dayMonth) {
		const [, dayRaw, monthRaw, yearRaw] = dayMonth;
		const key = monthRaw.replace(/[^A-Za-z]/g, '').toLowerCase();
		const month = MONTH_NAME_MAP.get(key) ?? MONTH_NAME_MAP.get(key.slice(0, 3));
		if (month) return buildIsoDate(Number(yearRaw), month, Number(dayRaw));
	}

	const monthDay = trimmed.match(/^([A-Za-z.]+)\s+(\d{1,2})(?:\s*,\s*|\s+)(\d{4})$/);
	if (monthDay) {
		const [, monthRaw, dayRaw, yearRaw] = monthDay;
		const key = monthRaw.replace(/[^A-Za-z]/g, '').toLowerCase();
		const month = MONTH_NAME_MAP.get(key) ?? MONTH_NAME_MAP.get(key.slice(0, 3));
		if (month) return buildIsoDate(Number(yearRaw), month, Number(dayRaw));
	}

	const dmyOrMdy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
	if (dmyOrMdy) {
		const [, firstRaw, secondRaw, yearRaw] = dmyOrMdy;
		const first = Number(firstRaw);
		const second = Number(secondRaw);
		if (first > 12) return buildIsoDate(Number(yearRaw), second, first);
		if (second > 12) return buildIsoDate(Number(yearRaw), first, second);
	}

	return null;
}

/**
 * Determine if a parameter name indicates a date field.
 * @param name - Parameter name to check.
 * @returns True if the name indicates a date field, false otherwise.
 */
function isDateParamName(name?: string | null): boolean {
	if (!name) return false;
	const trimmed = name.trim().toLowerCase();
	if (!trimmed || /^\d+$/.test(trimmed)) return false;
	const key = trimmed.replace(/_/g, '-');
	if (key === 'date') return true;
	if (key === 'access-date' || key === 'archive-date' || key === 'publication-date' || key === 'orig-date') return true;
	if (key === 'accessdate' || key === 'archivedate' || key === 'publicationdate' || key === 'origdate') return true;
	if (/^date\d+$/.test(key)) return true;
	if (/^(access|archive|publication|orig)date\d*$/.test(key)) return true;
	return false;
}

/**
 * Normalize a date parameter value if applicable.
 * @param name - Parameter name.
 * @param value - Parameter value.
 * @returns Normalized date value or original value if not a date param.
 */
function normalizeDateParamValue(name: string, value: string): string {
	if (!isDateParamName(name)) return value;
	const normalized = normalizeDateValue(value);
	return normalized ?? value;
}

/**
 * Normalize the body of a reference, reordering citation template parameters.
 * @param content - Raw content of the reference.
 * @returns Normalized reference body content.
 */
function normalizeRefBody(content: string): string {
	let text = normalizeContentBlock(content);
	const citeRegex = /\{\{\s*([Cc]ite\s+[^\|\}]+)\s*\|([\s\S]*?)\}\}/g;
	text = text.replace(citeRegex, (match, name: string, paramText: string) => {
		const params = parseTemplateParams('|' + paramText);
		if (!params.length) return match;

		const ordered: TemplateParam[] = [];
		const used = new Set<number>();
		const templateOrder = getTemplateParamOrder(name);
		const aliasMap = getTemplateAliasMap(name);

		const canonicalParam = (paramName?: string | null): string | null => {
			if (!paramName) return null;
			const norm = paramName.trim().toLowerCase();
			return aliasMap[norm] ?? norm;
		};

		templateOrder.forEach((key) => {
			const target = canonicalParam(key);
			if (!target) return;
			const idx = params.findIndex((p, paramIdx) => {
				if (used.has(paramIdx)) return false;
				return canonicalParam(p.name) === target;
			});
			if (idx >= 0 && !used.has(idx)) {
				ordered.push(params[idx]);
				used.add(idx);
			}
		});

		params.forEach((p, idx) => {
			if (!used.has(idx)) {
				ordered.push(p);
				used.add(idx);
			}
		});

		const parts = ordered.map((p) => {
			const val = String(p.value).trim();
			const name = p.name?.trim();
			if (name) {
				const normalizedValue = normalizeDateParamValue(name, val);
				return `${name}=${normalizedValue}`;
			}
			return val;
		});
		return `{{${name.trim()}${parts.length ? ' |' + parts.join(' |') : ''}}}`;
	});

	return text;
}

/**
 * Collapse chains of <ref/> and {{rp|...}} into single {{r|...}} templates.
 * @param text - Source wikitext to process.
 * @param preferTemplateR - Whether to prefer the {{r|...}} template format.
 * @returns Wikitext with collapsed reference chains.
 */
function collapseRefsAndRp(text: string, preferTemplateR: boolean): string {
	if (!preferTemplateR) return text;
	const chainRegex = /(?:(?:<ref\b[^>]*\/>\s*(?:\{\{rp\|[^}]+\}\}\s*)?)|\{\{r\|[^}]+\}\}\s*(?:\{\{rp\|[^}]+\}\}\s*)?)+/gi;

	/**
	 * Tokenize a block of text into ref, r, and rp tokens.
	 * @param block - Text block to tokenize.
	 * @returns Array of tokens with type and raw text.
	 */
	const tokenize = (block: string): Array<{ type: 'ref' | 'r' | 'rp'; raw: string }> => {
		const tokens: Array<{ type: 'ref' | 'r' | 'rp'; raw: string }> = [];
		const re = /<ref\b[^>]*\/>|{{r\|[^}]+}}|{{rp\|[^}]+}}/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(block)) !== null) {
			const raw = m[0];
			if (raw.startsWith('<ref')) tokens.push({ type: 'ref', raw });
			else if (raw.startsWith('{{r|')) tokens.push({ type: 'r', raw });
			else tokens.push({ type: 'rp', raw });
		}
		return tokens;
	};

	/**
	 * Parse an {{rp|...}} template into its parameters.
	 * @param raw - Raw {{rp|...}} template string.
	 * @returns Parsed parameters including page, pages, at, group, and unsupported flag.
	 */
	const parseRp = (raw: string): {
		page?: string;
		pages?: string;
		at?: string;
		group?: string;
		unsupported: boolean
	} => {
		const inner = raw.replace(/^\{\{rp\|/i, '').replace(/\}\}$/, '');
		const params = splitTemplateParams(inner);
		const res: {
			page?: string;
			pages?: string;
			at?: string;
			group?: string;
			unsupported: boolean
		} = { unsupported: false };
		params.forEach((p) => {
			const eq = p.indexOf('=');
			let key = '';
			let val = p;
			if (eq >= 0) {
				key = p.slice(0, eq).trim();
				val = p.slice(eq + 1).trim();
			}
			const norm = key.toLowerCase();
			if (!key || norm === 'p' || norm === 'page') res.page = val;
			else if (norm === 'pp' || norm === 'pages') res.pages = val;
			else if (norm === 'at' || norm === 'location' || norm === 'loc') res.at = val;
			else if (norm === 'group' || norm === 'grp' || norm === 'g') res.group = val;
			else res.unsupported = true;
		});
		return res;
	};

	/**
	 * Extract name and group attributes from a <ref ... /> tag.
	 * @param raw - Raw <ref ... /> tag string.
	 * @returns Object with name and group values or null if not present.
	 */
	const refInfo = (raw: string): { name: string | null; group: string | null } => {
		return { name: extractAttr(raw, 'name'), group: extractAttr(raw, 'group') };
	};

	/**
	 * Parse entries from an {{r|...}} template.
	 * @param raw - Raw {{r|...}} template string.
	 * @returns Array of RTemplateEntry objects or null if invalid.
	 */
	const rEntriesFromR = (raw: string): RTemplateEntry[] | null => {
		const match = raw.match(/^\{\{r\|([\s\S]+)\}\}$/i);
		if (!match) return null;
		const entries = parseRTemplateEntries(match[1]);
		if (entries.some((e) => e.kind === 'other')) return null;
		const nameCount = entries.filter((e) => e.isName).length;
		if (!nameCount) return null;
		if (entries.some((e) => !e.isName && e.index > nameCount)) return null;
		return entries;
	};

	/**
	 * Build an {{r|...}} template string from a chain of references.
	 * @param items - Array of reference items with name, group, page, pages, and at.
	 * @returns Rendered {{r|...}} template string.
	 */
	const buildChain = (items: Array<{
		name: string;
		group?: string | null;
		page?: string;
		pages?: string;
		at?: string;
	}>): string => {
		const params: string[] = [];
		const hasDetail = items.some((it) => it.page || it.pages || it.at);
		items.forEach((it, idx) => {
			const i = idx + 1;
			params.push(it.name);
			if (it.group) {
				if (hasDetail) {
					params.push(i === 1 ? `group=${it.group}` : `group${i}=${it.group}`);
				} else {
					params.push(`group=${it.group}`);
				}
			}
			if (it.page) params.push(i === 1 ? `p=${it.page}` : `p${i}=${it.page}`);
			if (it.pages) params.push(i === 1 ? `pp=${it.pages}` : `pp${i}=${it.pages}`);
			if (it.at) params.push(i === 1 ? `loc=${it.at}` : `loc${i}=${it.at}`);
		});
		return `{{r|${params.join('|')}}}`;
	};

	// Process each matched chain
	return text.replace(chainRegex, (block) => {
		if (block.includes('\n') || block.includes('\r')) {
			return block;
		}
		const trailingWs = block.match(/\s+$/)?.[0] ?? '';
		const trimmedBlock = trailingWs ? block.slice(0, -trailingWs.length) : block;
		const tokens = tokenize(trimmedBlock);
		if (!tokens.length) return block;
		const parts: string[] = [];
		let chain: Array<{ name: string; group?: string | null; page?: string; pages?: string; at?: string }> = [];

		const flushChain = () => {
			if (chain.length) {
				parts.push(buildChain(chain));
				chain = [];
			}
		};

		for (let i = 0; i < tokens.length; i++) {
			const tok = tokens[i];
			if (tok.type === 'ref') {
				const rpTok = tokens[i + 1]?.type === 'rp' ? tokens[i + 1] : null;
				if (rpTok) i++;
				const info = refInfo(tok.raw);
				if (!info.name) {
					flushChain();
					parts.push(tok.raw + (rpTok ? rpTok.raw : ''));
					continue;
				}
				const rp = rpTok ? parseRp(rpTok.raw) : { unsupported: false };
				if (rp.unsupported) {
					flushChain();
					parts.push(tok.raw + (rpTok ? rpTok.raw : ''));
					continue;
				}
				chain.push({
					name: info.name,
					group: info.group,
					page: rp.page,
					pages: rp.pages,
					at: rp.at
				});
				continue;
			}

			if (tok.type === 'r') {
				const rpTok = tokens[i + 1]?.type === 'rp' ? tokens[i + 1] : null;
				if (rpTok) i++;
				const entries = rEntriesFromR(tok.raw);
				if (!entries) {
					flushChain();
					parts.push(tok.raw + (rpTok ? rpTok.raw : ''));
					continue;
				}
				entries
					.filter((e) => e.isName)
					.forEach((e) => {
						const idx = e.index || 1;
						const group = entries.find((en) => en.kind === 'group' && en.index === idx)?.value ?? null;
						const page = entries.find((en) => en.kind === 'page' && en.index === idx)?.value;
						const pages = entries.find((en) => en.kind === 'pages' && en.index === idx)?.value;
						const at = entries.find((en) => en.kind === 'at' && en.index === idx)?.value;
						chain.push({ name: e.value, group, page, pages, at });
					});
				if (rpTok) {
					const rp = parseRp(rpTok.raw);
					if (!rp.unsupported && chain.length) {
						const last = chain[chain.length - 1];
						last.page = rp.page ?? last.page;
						last.pages = rp.pages ?? last.pages;
						last.at = rp.at ?? last.at;
						last.group = rp.group ?? last.group;
					} else {
						flushChain();
						parts.push(tok.raw + rpTok.raw);
					}
				}
				continue;
			}

			// rp without preceding ref/r – flush
			flushChain();
			parts.push(tok.raw);
		}
		flushChain();
		return parts.join(' ') + trailingWs;
	});
}

/**
 * Render an {{r|...}} template from entries, resolving names via references.
 * @param tpl - RTemplate entries to render.
 * @param refs - Map of reference records for name resolution.
 * @param preferTemplateR - Whether to prefer the {{r|...}} template format.
 * @param renameLookup - Optional function to rename reference names.
 * @returns Rendered {{r|...}} template string or null if not renderable.
 */
function renderRTemplate(
	tpl: { entries: RTemplateEntry[] },
	refs: Map<RefKey, RefRecord>,
	preferTemplateR: boolean,
	renameLookup?: (name: string) => string | null | undefined
): string | null {
	const nameEntries = tpl.entries.filter((e) => e.isName);
	if (!nameEntries.length) return null;

	const resolveName = (raw: string): string | null => {
		const ref = refs.get(refKey(raw, null));
		const canonical = ref?.canonical ?? ref;
		const mapped = renameLookup ? renameLookup(raw) : undefined;
		return mapped !== undefined ? mapped : canonical?.name ?? (ref ? null : raw);
	};

	if (preferTemplateR) {
		// Preserve all params; rename names.
		const adjusted = tpl.entries.map((e) => {
			if (!e.isName) return e;
			const next = resolveName(e.value);
			if (!next) return e;
			return { ...e, value: next };
		});
		return buildRTemplateString(adjusted, undefined);
	}

	// Convert to <ref> + optional {{rp}} when lossless; otherwise emit preserved {{r}}.
	const segments: string[] = [];
	const used = new Set<RTemplateEntry>();
	let pendingUnsupported: RTemplateEntry[] = [];

	const flushPending = () => {
		if (!pendingUnsupported.length) return;
		const tplStr = buildRTemplateString(pendingUnsupported, undefined, { renumber: true });
		if (tplStr) segments.push(tplStr);
		pendingUnsupported = [];
	};

	nameEntries.forEach((e, idx) => {
		const idxNum = e.index || idx + 1;
		const relevant = tpl.entries
			.filter((entry) => entry.index === idxNum)
			.filter((entry) => !used.has(entry));
		// Ensure name param is first for stable rendering
		const withoutName = relevant.filter((entry) => entry !== e);
		const orderedRelevant = [e, ...withoutName];
		const mappedRelevant = relevant.map((entry) => {
			if (!entry.isName) return entry;
			const next = resolveName(entry.value);
			return next ? { ...entry, value: next } : entry;
		});
		const hasUnsupported = mappedRelevant.some((entry) => entry.kind === 'other');
		const target = resolveName(e.value);
		if (!target) return;

		if (hasUnsupported) {
			pendingUnsupported.push(...orderedRelevant.map((entry) => {
				if (!entry.isName) return entry;
				const next = resolveName(entry.value);
				return next ? { ...entry, value: next } : entry;
			}));
			orderedRelevant.forEach((entry) => used.add(entry));
			return;
		}

		flushPending();
		const group = mappedRelevant.find((r) => r.kind === 'group' && r.index === idxNum)?.value ?? null;
		const page = mappedRelevant.find((r) => r.kind === 'page' && r.index === idxNum)?.value;
		const pagesEntry = mappedRelevant.find((r) => r.kind === 'pages' && r.index === idxNum);
		const pages = pagesEntry?.value;
		const pagesLabel = pagesEntry?.key && pagesEntry.key.toLowerCase().startsWith('pages') ? 'pages' : 'pp';
		const at = mappedRelevant.find((r) => r.kind === 'at' && r.index === idxNum)?.value;

		let chunk = renderRefSelf(target, group, false);
		const rpParts: string[] = [];
		if (page) rpParts.push(`p=${page}`);
		if (pages) rpParts.push(`${pagesLabel}=${pages}`);
		if (at) rpParts.push(`at=${at}`);
		if (rpParts.length) chunk += `{{rp|${rpParts.join('|')}}}`;
		segments.push(chunk);
		orderedRelevant.forEach((entry) => used.add(entry));
	});

	if (pendingUnsupported.length) {
		const remaining = tpl.entries.filter((entry) => !used.has(entry));
		pendingUnsupported.push(...remaining);
	}
	flushPending();

	return segments.length ? segments.join('') : null;
}

/**
 * Normalize a block of content by trimming spaces and collapsing blank lines.
 * @param content - Content block to normalize.
 * @returns Normalized content block.
 */
function normalizeContentBlock(content: string): string {
	let text = String(content ?? '');
	text = text.replace(/[ \t]+\n/g, '\n'); // trim trailing spaces on lines
	text = text.replace(/\n{3,}/g, '\n\n'); // collapse excessive blank lines
	return text.trim();
}

/**
 * Update a reflist template with new refs parameter value.
 * @param tpl - Template match to update.
 * @param ldrEntries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Updated reflist template string.
 */
function updateReflistTemplate(tpl: TemplateMatch, ldrEntries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean): string {
	const params = tpl.params.slice();
	const hasRefsParam = params.some((p) => p.name && p.name.toLowerCase() === 'refs');
	const refsValue = renderRefsValue(ldrEntries, sort);

	if (ldrEntries.length === 0) {
		// Remove refs param if present
		const filtered = params.filter((p) => !(p.name && p.name.toLowerCase() === 'refs'));
		return renderTemplate(tpl.name, filtered);
	}

	if (hasRefsParam) {
		const next = params.map((p) => (p.name && p.name.toLowerCase() === 'refs' ? { ...p, value: refsValue } : p));
		return renderTemplate(tpl.name, next);
	}

	params.push({ name: 'refs', value: refsValue });
	return renderTemplate(tpl.name, params);
}

/**
 * Update a <references> tag with new refs parameter value.
 * @param tag - References tag match to update.
 * @param ldrEntries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Updated references tag string.
 */
function updateReferencesTag(tag: ReferencesTagMatch, ldrEntries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean): string {
	const attrText = tag.attrs ? ` ${tag.attrs}` : '';
	if (ldrEntries.length === 0) {
		return `<references${attrText} />`;
	}
	const refsValue = renderRefsValue(ldrEntries, sort);
	return `<references${attrText}>${refsValue}</references>`;
}

/**
 * Build a <references> tag string from entries and optional group.
 * @param entries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @param group - Optional group name.
 * @returns Rendered references tag string.
 */
function buildReferencesTag(entries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean, group: string | null): string {
	const attrText = group ? ` group="${escapeAttr(group)}"` : '';
	if (entries.length === 0) {
		return `<references${attrText} />`;
	}
	const refsValue = renderRefsValue(entries, sort);
	return `<references${attrText}>${refsValue}</references>`;
}

/**
 * Convert a reflist template into a references tag if conversion is safe.
 * @param params - Template parameters from the reflist template.
 * @returns Group value if convertible, null for no group, or undefined if not convertible.
 */
function getConvertibleReflistGroup(params: TemplateParam[]): string | null | undefined {
	let groupValue: string | null = null;
	let seenGroup = false;
	let seenRefs = false;
	for (const param of params) {
		if (!param.name) return undefined;
		const key = param.name.trim().toLowerCase();
		if (key === 'refs') {
			if (seenRefs) return undefined;
			seenRefs = true;
			continue;
		}
		if (key === 'group') {
			if (seenGroup) return undefined;
			seenGroup = true;
			const trimmed = (param.value ?? '').trim();
			groupValue = trimmed.length ? trimmed : null;
			continue;
		}
		return undefined;
	}
	return groupValue;
}

/**
 * Convert a <references> tag into a reflist group if conversion is safe.
 * @param attrs - Raw attributes string from the references tag.
 * @returns Group value if convertible, null for no group, or undefined if not convertible.
 */
function getConvertibleReferencesGroup(attrs: string): string | null | undefined {
	const trimmed = (attrs ?? '').trim();
	if (!trimmed) return null;
	const match = trimmed.match(/^\s*group\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))\s*$/i);
	if (!match) return undefined;
	const value = match[1] ?? match[2] ?? match[3] ?? '';
	return value.trim().length ? value.trim() : null;
}

/**
 * Build a reflist template string from entries and optional group.
 * @param entries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @param group - Optional group name.
 * @returns Rendered reflist template string.
 */
function buildReflistTemplate(entries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean, group: string | null): string {
	const params: TemplateParam[] = [];
	if (group) params.push({ name: 'group', value: group });
	if (entries.length) {
		const refsValue = renderRefsValue(entries, sort);
		params.push({ name: 'refs', value: refsValue });
	}
	return renderTemplate('reflist', params);
}

/**
 * Render the value for a refs parameter from entries.
 * @param entries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Rendered refs parameter value.
 */
function renderRefsValue(entries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean): string {
	const sorted = sort ? entries.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, {
		sensitivity: 'base', numeric: true
	})) : entries;
	return '\n' + sorted.map((e) => renderRefTag(e.name, e.group, e.content)).join('\n') + '\n';
}

/**
 * Render a template with given name and parameters.
 * @param name - Template name.
 * @param params - Template parameters.
 * @returns Rendered template string.
 */
function renderTemplate(name: string, params: TemplateParam[]): string {
	const parts = params.map((p) => {
		if (p.name) return `${p.name}=${p.value}`;
		return p.value;
	});
	return `{{${name}${parts.length ? '|' + parts.join('|') : ''}}}`;
}

/**
 * Build an {{r|...}} template string from entries.
 * @param entries - RTemplate entries to include.
 * @param renameLookup - Optional function to rename reference names.
 * @param opts - Options for rendering.
 * @returns Rendered {{r|...}} template string or null if no names present.
 */
function buildRTemplateString(
	entries: RTemplateEntry[],
	renameLookup?: (name: string) => string | null | undefined,
	opts?: { renumber?: boolean }
): string | null {
	if (!entries.some((e) => e.isName)) return null;
	const renumber = Boolean(opts?.renumber);
	const nameIndexMap = new Map<number, number>();
	if (renumber) {
		let counter = 0;
		entries.forEach((e) => {
			if (!e.isName) return;
			if (!nameIndexMap.has(e.index)) {
				nameIndexMap.set(e.index, ++counter);
			}
		});
	}
	const parts: string[] = [];
	entries.forEach((e) => {
		const targetIndex = renumber
			? (nameIndexMap.get(e.index) ?? (nameIndexMap.size ? Math.max(...nameIndexMap.values()) : e.index))
			: e.index;
		let val = e.value;
		if (e.isName) {
			const mapped = renameLookup ? renameLookup(e.value) : undefined;
			val = mapped !== undefined ? (mapped ?? val) : val;
			if (e.key) {
				let keyOut = e.key;
				if (renumber) {
					const base = e.key.replace(/\d+$/, '');
					const hadDigits = base.length !== e.key.length;
					keyOut = hadDigits ? `${base}${targetIndex > 1 ? targetIndex : ''}` : base;
				}
				parts.push(`${keyOut}=${val}`);
			} else {
				parts.push(val);
			}
			return;
		}
		const normalizeKey = (): string | null => {
			if (e.key) {
				if (renumber) {
					const base = e.key.replace(/\d+$/, '');
					const hadDigits = base.length !== e.key.length;
					return hadDigits ? `${base}${targetIndex > 1 ? targetIndex : ''}` : base;
				}
				return e.key;
			}
			return null;
		};
		const explicitKey = normalizeKey();
		if (explicitKey) {
			parts.push(`${explicitKey}=${val}`);
			return;
		}
		const idxSuffix = targetIndex > 1 ? targetIndex.toString() : '';
		const mappedKey =
			e.kind === 'group'
				? 'group'
				: e.kind === 'page'
					? `p${idxSuffix}`
					: e.kind === 'pages'
						? `pp${idxSuffix}`
						: e.kind === 'at'
							? `loc${idxSuffix}`
							: null;
		if (mappedKey) parts.push(`${mappedKey}=${val}`);
	});
	return `{{r|${parts.join('|')}}}`;
}

/**
 * Build a standalone reflist template with given entries.
 * @param entries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Rendered standalone reflist template string.
 */
function buildStandaloneReflist(entries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean, group: string | null): string {
	return `\n${buildReflistTemplate(entries, sort, group)}`;
}

/**
 * Build a standalone <references> tag with given entries.
 * @param entries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Rendered standalone references tag string.
 */
function buildStandaloneReferences(entries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean, group: string | null): string {
	return `\n${buildReferencesTag(entries, sort, group)}`;
}

interface Replacement {
	start: number;
	end: number;
	text: string;
}

/**
 * Collapse overlapping replacements by keeping the last one for each range.
 * @param repls - Array of replacements to collapse.
 * @returns Collapsed array of replacements.
 */
function collapseReplacements(repls: Replacement[]): Replacement[] {
	// Remove duplicates and sort
	const filtered = repls.slice().sort((a, b) => b.start - a.start);
	const seen = new Set<string>();
	const result: Replacement[] = [];
	for (const r of filtered) {
		const key = `${r.start}-${r.end}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(r);
	}
	return result;
}

/**
 * Apply a series of replacements to a source string.
 * @param source - Original source string.
 * @param replacements - Array of replacements to apply.
 * @returns Modified string after applying replacements.
 */
function applyReplacements(source: string, replacements: Replacement[]): string {
	let output = source;
	let offset = 0;
	const sorted = replacements.slice().sort((a, b) => a.start - b.start);
	sorted.forEach((r) => {
		const start = r.start + offset;
		const end = r.end + offset;
		output = output.slice(0, start) + r.text + output.slice(end);
		offset += r.text.length - (r.end - r.start);
	});
	return output;
}

type LocationMode = 'keep' | 'all_inline' | 'all_ldr' | { minUsesForLdr: number };

export interface TransformOptions {
	renameMap?: Record<string, string | null>;
	renameNameless?: Record<string, string | null>;
	dedupe?: boolean;
	locationMode?: LocationMode;
	sortRefs?: boolean;
	preferTemplateR?: boolean;
	preferTemplateReflist?: boolean;
	reflistTemplates?: string[];
	normalizeAll?: boolean;
	contentOverrides?: Record<string, string>;
}

interface TransformResult {
	wikitext: string;
	changes: {
		renamed: Array<{ from: string; to: string | null }>;
		deduped: Array<{ from: string; to: string }>;
		movedToLdr: string[];
		movedToInline: string[];
	};
	warnings: string[];
}

const DEFAULT_REFLIST_TEMPLATES = ['reflist', 'references'];

/**
 * Normalize reference keys in the map.
 * Merges references with the same name and group into a single record.
 * @param refs - Map of reference records to normalize.
 * @returns New map of normalized reference records.
 */
function normalizeRefKeys(refs: Map<RefKey, RefRecord>): Map<RefKey, RefRecord> {
	const next = new Map<RefKey, RefRecord>();
	let namelessCounter = 0;
	refIterator(refs).forEach((ref) => {
		const key = ref.name ? refKey(ref.name, ref.group) : ref.key || ref.id || `__nameless_${namelessCounter++}`;
		ref.key = key;
		ref.id = ref.id || key;
		const existing = next.get(key);
		if (existing) {
			existing.definitions.push(...ref.definitions);
			existing.ldrDefinitions.push(...ref.ldrDefinitions);
			existing.uses.push(...ref.uses);
			ref.canonical = existing;
		} else {
			next.set(key, ref);
		}
	});
	return next;
}

/**
 * Transform wikitext by applying rename, dedupe, and location rules without saving.
 * Produces updated wikitext and a change summary.
 * @param wikitext - Source wikitext to transform.
 * @param options - Transformation options.
 * @returns Transformation result with updated wikitext and change details.
 */
export function transformWikitext(wikitext: string, options: TransformOptions = {}): TransformResult {
	const warnings: string[] = [];
	const renameMap = normalizeRenameMap(options.renameMap || {});
	const renameNameless = options.renameNameless || {};
	const dedupe = Boolean(options.dedupe);
	const sortRefs = options.sortRefs === undefined ? false : Boolean(options.sortRefs);
	const preferTemplateR = Boolean(options.preferTemplateR);
	const preferTemplateReflist = options.preferTemplateReflist === undefined ? true : Boolean(options.preferTemplateReflist);
	const normalizeAll = options.normalizeAll === undefined ? false : options.normalizeAll;
	const reflistNames = (options.reflistTemplates && options.reflistTemplates.length > 0 ? options.reflistTemplates : DEFAULT_REFLIST_TEMPLATES).map((n) => n.toLowerCase());
	const targetMode = normalizeLocationMode(options.locationMode);
	const contentOverrides = options.contentOverrides || {};
	const contentOverrideLookup = (ref: RefRecord): string | undefined => {
		const candidates = [ref.id, ref.key];
		for (const key of candidates) {
			if (!key) continue;
			if (Object.prototype.hasOwnProperty.call(contentOverrides, key)) {
				return contentOverrides[key];
			}
		}
		return undefined;
	};

	const ctx = parseWikitext(wikitext, reflistNames);
	ctx.refs = normalizeRefKeys(ctx.refs);

	applyRenames(ctx.refs, renameMap, renameNameless);
	ctx.refs = normalizeRefKeys(ctx.refs);
	const deduped = dedupe ? applyDedupe(ctx.refs) : [];
	assignLocations(ctx.refs, targetMode);

	const plan = buildReplacementPlan(ctx, {
		preferTemplateR,
		preferTemplateReflist,
		sortRefs,
		normalizeAll,
		locationModeKeep: targetMode === 'keep',
		renameLookup: (name: string) => renameMap[name],
		contentOverrideLookup
	});

	const replaced = applyReplacements(wikitext, plan.replacements);
	const finalText = preferTemplateR ? collapseRefsAndRp(replaced, true) : replaced;

	return {
		wikitext: finalText, changes: {
			renamed: Object.entries(renameMap).map(([from, to]) => ({ from, to })),
			deduped,
			movedToInline: plan.movedInline,
			movedToLdr: plan.movedLdr
		}, warnings
	};
}

/**
 * Build a map of ref identifiers to their first captured content from wikitext,
 * including list-defined references inside reflist templates.
 * @param wikitext - Source wikitext.
 * @param reflistTemplates - Optional override of reflist template names.
 * @returns Map of ref names/IDs to their content strings.
 */
export function getRefContentMap(wikitext: string, reflistTemplates?: string[]): Map<string, string> {
	const reflistNames = (reflistTemplates && reflistTemplates.length > 0 ? reflistTemplates : DEFAULT_REFLIST_TEMPLATES).map((n) => n.toLowerCase());
	const ctx = parseWikitext(wikitext, reflistNames);
	const refs = normalizeRefKeys(ctx.refs);
	const map = new Map<string, string>();
	refIterator(refs).forEach((ref) => {
		const content = firstContent(ref);
		if (!content) return;
		if (ref.name) map.set(ref.name, content);
		map.set(ref.id || ref.key, content);
	});
	return map;
}

/**
 * Normalize location mode input into a consistent format.
 * @param mode - Input location mode.
 * @returns Normalized location mode.
 */
function normalizeLocationMode(mode?: LocationMode): LocationMode {
	if (mode === 'keep') return 'keep';
	if (!mode) return 'keep';
	if (typeof mode === 'string') return mode;
	if (mode.minUsesForLdr >= 1) return mode;
	return { minUsesForLdr: 2 };
}

/**
 * Normalize rename map input.
 * @param rename - Raw rename map.
 * @returns Normalized rename map.
 */
function normalizeRenameMap(rename: Record<string, string | null>): Record<string, string | null> {
	const map: Record<string, string | null> = {};
	Object.entries(rename).forEach(([k, v]) => {
		if (!k) return;
		if (v === undefined) return;
		if (v === k) return;
		map[k] = v;
	});
	return map;
}

/**
 * Apply renames to references based on provided maps.
 * Handles both named and nameless references.
 * @param refs - Map of reference records to modify.
 * @param rename - Map of current names to new names (or null to remove).
 * @param renameNameless - Map of nameless ref IDs/keys to new names (or null to remove).
 */
function applyRenames(refs: Map<RefKey, RefRecord>, rename: Record<string, string | null>, renameNameless: Record<string, string | null>): void {
	const appliedNameless = new Set<string>();
	refs.forEach((ref) => {
		if (ref.name) {
			const next = rename[ref.name];
			if (next === null) {
				ref.name = null;
			} else if (next && next !== ref.name) {
				ref.name = next;
			}
		} else {
			const next = renameNameless[ref.id] || renameNameless[ref.key];
			if (next === null) {
				ref.name = null;
				ref.key = ref.key || ref.id || refKey(ref.name, ref.group);
				appliedNameless.add(ref.id);
				appliedNameless.add(ref.key);
			} else if (next) {
				ref.name = next;
				ref.key = refKey(ref.name, ref.group);
				appliedNameless.add(ref.id);
				appliedNameless.add(ref.key);
			}
		}
	});

	// Fallback: apply remaining nameless renames to unnamed refs in order
	const remainingEntries = Object.entries(renameNameless).filter(([k]) => !appliedNameless.has(k));
	if (remainingEntries.length) {
		let idx = 0;
		refIterator(refs).forEach((ref) => {
			if (idx >= remainingEntries.length) return;
			if (ref.name) return;
			const [, newName] = remainingEntries[idx];
			ref.name = newName;
			ref.key = refKey(ref.name, ref.group);
			idx++;
		});
	}
}

/**
 * Normalize content by collapsing whitespace and trimming.
 * @param content - Content string to normalize.
 * @returns Normalized content string.
 */
function normalizeContent(content: string): string {
	return content.replace(/\s+/g, ' ').trim();
}

type TemplateParamEntry = {
	key: string;
	value: string;
	paramName: string;
	paramValue: string;
};

type TemplateFingerprint = {
	normalizedName: string;
	originalName: string;
	params: Map<string, { values: string[]; entries: TemplateParamEntry[] }>;
	templateText: string;
	leadingWhitespace: string;
	trailingWhitespace: string;
};

type TemplateCanonicalEntry = {
	canonical: RefRecord;
	fingerprint: TemplateFingerprint;
};

const PARAM_KEY_ALIASES = new Map<string, string>([
	['accessdate', 'access-date'],
	['archiveurl', 'archive-url'],
	['archivedate', 'archive-date']
]);

/**
 * Build a fingerprint for a template content block.
 * @param content - Template content string.
 * @returns Template fingerprint or null if not a single template.
 */
function buildTemplateFingerprint(content: string): TemplateFingerprint | null {
	if (!content) return null;
	const leadingWhitespace = content.match(/^\s*/)?.[0] ?? '';
	const trailingWhitespace = content.match(/\s*$/)?.[0] ?? '';
	const core = content.slice(leadingWhitespace.length, content.length - trailingWhitespace.length);
	const trimmed = core.trim();
	if (!trimmed || !isSingleTemplate(trimmed)) return null;
	const nameMatch = trimmed.match(/^\{\{\s*([^{|}]+?)(?=\s*\||\s*}})/);
	if (!nameMatch) return null;
	const originalName = nameMatch[1].trim();
	const normalizedName = normalizeTemplateName(originalName);
	const params = parseTemplateParams(trimmed);
	const paramBuckets = new Map<string, { values: string[]; entries: TemplateParamEntry[] }>();
	params.forEach((param) => {
		const normalizedKey = normalizeParamKey(param.name);
		if (!normalizedKey) return;
		const normalizedValue = canonicalizeParamValue(param.value);
		const bucket = paramBuckets.get(normalizedKey) ?? { values: [], entries: [] };
		bucket.values.push(normalizedValue);
		bucket.entries.push({
			key: normalizedKey,
			value: normalizedValue,
			paramName: param.name || normalizedKey,
			paramValue: param.value.trim()
		});
		paramBuckets.set(normalizedKey, bucket);
	});
	return {
		normalizedName,
		originalName,
		params: paramBuckets,
		templateText: trimmed,
		leadingWhitespace,
		trailingWhitespace
	};
}

/**
 * Check if a text block is a single well-formed template.
 * @param text - Text block to check.
 * @returns True if the text is a single template, false otherwise.
 */
function isSingleTemplate(text: string): boolean {
	if (!text.startsWith('{{') || !text.endsWith('}}')) return false;
	let depth = 0;
	for (let i = 0; i < text.length - 1; i++) {
		const pair = text[i] + text[i + 1];
		if (pair === '{{') {
			depth++;
			i++;
			continue;
		}
		if (pair === '}}') {
			depth--;
			if (depth === 0) {
				const remainder = text.slice(i + 2).trim();
				if (remainder.length > 0) return false;
			}
			i++;
			continue;
		}
		if (depth === 0 && !/\s/.test(text[i])) {
			return false;
		}
	}
	return depth === 0;
}

/**
 * Normalize a template name by replacing underscores, trimming, and lowercasing.
 * @param name - Template name to normalize.
 * @returns Normalized template name.
 */
function normalizeTemplateName(name: string): string {
	return name.replace(/_/g, ' ').trim().toLowerCase();
}

/**
 * Normalize a template parameter key.
 * @param name - Parameter name to normalize.
 * @returns Normalized parameter key or null if invalid.
 */
function normalizeParamKey(name?: string | null): string | null {
	if (name === undefined || name === null) return null;
	const trimmed = name.trim();
	if (!trimmed) return null;
	if (/^\d+$/.test(trimmed)) return trimmed;
	const lower = trimmed.toLowerCase();
	const collapsed = lower.replace(/[_-]+/g, '-');
	return PARAM_KEY_ALIASES.get(collapsed) ?? collapsed;
}

/**
 * Canonicalize a template parameter value by collapsing whitespace and trimming.
 * @param value - Parameter value to canonicalize.
 * @returns Canonicalized parameter value.
 */
function canonicalizeParamValue(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * Build a base key for a template fingerprint.
 * @param fp - Template fingerprint.
 * @returns Base key string.
 */
function buildTemplateBaseKey(fp: TemplateFingerprint): string {
	return fp.normalizedName;
}

/**
 * Compare two arrays for strict equality in order and length.
 * @param a - First array.
 * @param b - Second array.
 * @returns True if arrays match exactly, false otherwise.
 */
function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * Check if a parameter value uses wiki link markup.
 * @param value - Parameter value string.
 * @returns True if value contains wiki link markup.
 */
function hasWikiLink(value: string): boolean {
	return /\[\[[^\]]+]]/.test(value);
}

/**
 * Get the hostname from a template fingerprint URL parameter if available.
 * @param fp - Template fingerprint.
 * @returns Hostname string or null if unavailable.
 */
function getUrlHost(fp: TemplateFingerprint): string | null {
	const urlBucket = fp.params.get('url');
	if (!urlBucket || urlBucket.entries.length !== 1) return null;
	const urlValue = urlBucket.entries[0].paramValue.trim();
	if (!urlValue) return null;
	try {
		const parsed = new URL(urlValue);
		return parsed.hostname ? parsed.hostname.toLowerCase() : null;
	} catch {
		return null;
	}
}

/**
 * Check if a website value is just the domain for the associated URL param.
 * @param entry - Website parameter entry.
 * @param fp - Template fingerprint for context.
 * @returns True if the website is a domain-only URL for the same host.
 */
function isWebsiteDomainOnly(entry: TemplateParamEntry, fp: TemplateFingerprint): boolean {
	const websiteValue = entry.paramValue.trim();
	if (!websiteValue) return false;
	const urlHost = getUrlHost(fp);
	const normalizeHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');
	if (!urlHost) return false;
	const normalizedValue = normalizeHost(websiteValue);
	const normalizedHost = normalizeHost(urlHost);
	return normalizedValue === normalizedHost;
}

/**
 * Decide which parameter entry is better filled based on heuristics.
 * @param key - Normalized parameter key.
 * @param a - First parameter entry.
 * @param b - Second parameter entry.
 * @param aCtx - First parameter fingerprint context.
 * @param bCtx - Second parameter fingerprint context.
 * @returns 1 if a is preferred, -1 if b is preferred, 0 if no preference.
 */
function preferParamEntry(
	key: string,
	a: TemplateParamEntry,
	b: TemplateParamEntry,
	aCtx: TemplateFingerprint,
	bCtx: TemplateFingerprint
): 1 | 0 | -1 {
	const aValue = a.paramValue.trim();
	const bValue = b.paramValue.trim();
	const aLinked = hasWikiLink(aValue);
	const bLinked = hasWikiLink(bValue);
	if (aLinked !== bLinked) return aLinked ? 1 : -1;

	if (key === 'website') {
		const aDomain = isWebsiteDomainOnly(a, aCtx);
		const bDomain = isWebsiteDomainOnly(b, bCtx);
		if (aDomain !== bDomain) return aDomain ? -1 : 1;
	}

	return 0;
}

/**
 * Check if two template fingerprints are compatible for deduplication.
 * @param a - First template fingerprint.
 * @param b - Second template fingerprint.
 * @returns True if compatible, false otherwise.
 */
function templatesCompatible(a: TemplateFingerprint, b: TemplateFingerprint): boolean {
	if (a.normalizedName !== b.normalizedName) return false;
	for (const [key, existing] of a.params.entries()) {
		const incoming = b.params.get(key);
		if (!incoming) continue;
		if (arraysEqual(existing.values, incoming.values)) continue;
		if (existing.values.length !== 1 || incoming.values.length !== 1) return false;
		const preferred = preferParamEntry(key, existing.entries[0], incoming.entries[0], a, b);
		if (preferred === 0) return false;
	}
	for (const [key, incoming] of b.params.entries()) {
		const existing = a.params.get(key);
		if (!existing) continue;
		if (arraysEqual(existing.values, incoming.values)) continue;
		if (existing.values.length !== 1 || incoming.values.length !== 1) return false;
		const preferred = preferParamEntry(key, existing.entries[0], incoming.entries[0], a, b);
		if (preferred === 0) return false;
	}
	return true;
}

/**
 * Insert a parameter into a template text block.
 * @param text - Original template text.
 * @param addition - Parameter entry to insert.
 * @returns Updated template text with the parameter inserted.
 */
function insertTemplateParam(text: string, addition: TemplateParamEntry): string {
	const closingIndex = findTemplateCloseIndex(text);
	if (closingIndex === -1) return text;
	const beforeClose = text.slice(0, closingIndex);
	const afterClose = text.slice(closingIndex);
	const trailingWhitespaceMatch = beforeClose.match(/\s*$/);
	const trailingWhitespace = trailingWhitespaceMatch ? trailingWhitespaceMatch[0] : '';
	const withoutTrailing = beforeClose.slice(0, beforeClose.length - trailingWhitespace.length);
	const newlineIdx = withoutTrailing.lastIndexOf('\n');
	const indent = newlineIdx >= 0 ? (withoutTrailing.slice(newlineIdx + 1).match(/^\s*/)?.[0] ?? '') : '';
	const prefix = newlineIdx >= 0 ? `\n${indent}|` : '|';
	const paramText = formatTemplateParam(addition);
	const updatedBefore = `${withoutTrailing}${prefix}${paramText}${trailingWhitespace}`;
	return `${updatedBefore}${afterClose}`;
}

/**
 * Replace a parameter value in a template text block.
 * @param text - Original template text.
 * @param key - Normalized parameter key to replace.
 * @param entry - Parameter entry with replacement value.
 * @returns Updated template text with the parameter replaced.
 */
function replaceTemplateParam(text: string, key: string, entry: TemplateParamEntry): string {
	const match = text.match(/^\{\{\s*([^{|}]+?)(?=\s*\||\s*}})/);
	if (!match) return text;
	const inner = text.replace(/^\{\{/, '').replace(/\}\}$/, '');
	const pipeIdx = inner.indexOf('|');
	if (pipeIdx === -1) return text;
	const namePart = inner.slice(0, pipeIdx);
	const paramsText = inner.slice(pipeIdx + 1);
	const parts = splitTemplateParams(paramsText);
	let replaced = false;
	const updated = parts.map((part) => {
		const eqIdx = part.indexOf('=');
		const namePartRaw = eqIdx >= 0 ? part.slice(0, eqIdx) : '';
		const normalized = normalizeParamKey(namePartRaw.trim());
		if (normalized !== key) return part;
		replaced = true;
		const leading = part.match(/^\s*/)?.[0] ?? '';
		const trailing = part.match(/\s*$/)?.[0] ?? '';
		const paramName = entry.paramName || namePartRaw.trim() || key;
		const paramValue = entry.paramValue;
		if (paramName) return `${leading}${paramName}=${paramValue}${trailing}`;
		return `${leading}${paramValue}${trailing}`;
	});
	if (!replaced) return text;
	return `{{${namePart}|${updated.join('|')}}}`;
}

/**
 * Format a parameter entry into a template parameter string.
 * @param entry - Parameter entry.
 * @returns Formatted parameter string.
 */
function formatTemplateParam(entry: TemplateParamEntry): string {
	const value = entry.paramValue || '';
	if (entry.paramName) {
		return `${entry.paramName}=${value}`;
	}
	return value;
}

/**
 * Find the index of the closing braces of a template in text.
 * @param text - Template text block.
 * @returns Index of the first closing brace of the template or -1 if not found.
 */
function findTemplateCloseIndex(text: string): number {
	let depth = 0;
	for (let i = 0; i < text.length - 1; i++) {
		if (text[i] === '{' && text[i + 1] === '{') {
			depth++;
			i++;
			continue;
		}
		if (text[i] === '}' && text[i + 1] === '}') {
			depth--;
			if (depth === 0) {
				return i;
			}
			i++;
		}
	}
	return -1;
}

/**
 * Merge missing parameters from an incoming template fingerprint into a canonical entry.
 * Updates the template text and content override if changes are made.
 * @param entry - Canonical template entry to update.
 * @param incoming - Incoming template fingerprint with mergeable parameters.
 */
function mergeTemplateParams(entry: TemplateCanonicalEntry, incoming: TemplateFingerprint): void {
	let templateText = entry.fingerprint.templateText;
	let changed = false;
	incoming.params.forEach((bucket, key) => {
		const existingBucket = entry.fingerprint.params.get(key);
		if (existingBucket) {
			if (!arraysEqual(existingBucket.values, bucket.values) && existingBucket.values.length === 1 && bucket.values.length === 1) {
				const preferred = preferParamEntry(key, existingBucket.entries[0], bucket.entries[0], entry.fingerprint, incoming);
				if (preferred === -1) {
					entry.fingerprint.params.set(key, { values: [...bucket.values], entries: [...bucket.entries] });
					templateText = replaceTemplateParam(templateText, key, bucket.entries[0]);
					changed = true;
				}
			}
			return;
		}
		entry.fingerprint.params.set(key, { values: [...bucket.values], entries: [...bucket.entries] });
		bucket.entries.forEach((addition) => {
			templateText = insertTemplateParam(templateText, addition);
			changed = true;
		});
	});
	if (changed) {
		entry.fingerprint.templateText = templateText;
		entry.canonical.contentOverride = `${entry.fingerprint.leadingWhitespace}${templateText}${entry.fingerprint.trailingWhitespace}`;
	}
}

/**
 * Inherit definition content from source reference to target reference if target lacks definitions.
 * @param target - Target reference record to inherit definitions into.
 * @param source - Source reference record to inherit definitions from.
 */
function inheritDefinitionContent(target: RefRecord, source: RefRecord): void {
	if (target.definitions.length === 0 && source.definitions.length > 0) {
		target.definitions.push(...source.definitions);
	}
	if (target.ldrDefinitions.length === 0 && source.ldrDefinitions.length > 0) {
		target.ldrDefinitions.push(...source.ldrDefinitions);
	}
}

/**
 * Deduplicate references based on their content.
 * References with identical content are merged, with one canonical reference retained.
 * @param refs - Map of reference records to deduplicate.
 * @returns Array of changes made during deduplication.
 */
function applyDedupe(refs: Map<RefKey, RefRecord>): Array<{ from: string; to: string }> {
	const canonicalByContent = new Map<string, RefRecord>();
	const templateCanonicals = new Map<string, TemplateCanonicalEntry[]>();
	const changes: Array<{ from: string; to: string }> = [];

	refIterator(refs).forEach((ref) => {
		const content = firstContent(ref);
		if (!content || !ref.name) return;
		const templateInfo = buildTemplateFingerprint(content);
		if (templateInfo) {
			const baseKey = buildTemplateBaseKey(templateInfo);
			const bucket = templateCanonicals.get(baseKey);
			if (bucket) {
				const match = bucket.find((entry) => templatesCompatible(entry.fingerprint, templateInfo));
				if (match && match.canonical.name) {
					ref.canonical = match.canonical;
					inheritDefinitionContent(match.canonical, ref);
					mergeTemplateParams(match, templateInfo);
					changes.push({ from: ref.name, to: match.canonical.name });
					return;
				}
			}
			const entry: TemplateCanonicalEntry = { canonical: ref, fingerprint: templateInfo };
			if (bucket) {
				bucket.push(entry);
			} else {
				templateCanonicals.set(baseKey, [entry]);
			}
			ref.canonical = ref;
			return;
		}
		const norm = normalizeContent(content);
		const existing = canonicalByContent.get(norm);
		if (existing && existing.name) {
			ref.canonical = existing;
			inheritDefinitionContent(existing, ref);
			changes.push({ from: ref.name, to: existing.name });
		} else {
			canonicalByContent.set(norm, ref);
			ref.canonical = ref;
		}
	});

	return changes;
}

/**
 * Assign target locations (inline or ldr) to references based on mode and usage.
 * @param refs - Map of reference records to assign locations.
 * @param mode - Location mode determining assignment rules.
 */
function assignLocations(refs: Map<RefKey, RefRecord>, mode: LocationMode): void {
	const processed = new Set<RefRecord>();
	refIterator(refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		if (processed.has(canonical)) return;
		if (mode === 'keep') {
			if (canonical.ldrDefinitions.length > 0) {
				canonical.targetLocation = 'ldr';
			} else {
				canonical.targetLocation = 'inline';
			}
			processed.add(canonical);
			return;
		}
		if (!canonical.name) {
			canonical.targetLocation = 'inline';
			processed.add(canonical);
			return;
		}

		if (mode === 'all_inline') {
			canonical.targetLocation = 'inline';
			processed.add(canonical);
			return;
		}
		if (mode === 'all_ldr') {
			canonical.targetLocation = 'ldr';
			processed.add(canonical);
			return;
		}
		const usesCount = aggregateUses(refs, canonical).length;
		const threshold = mode.minUsesForLdr;
		canonical.targetLocation = usesCount >= threshold ? 'ldr' : 'inline';
		processed.add(canonical);
	});
}

/**
 * Aggregate all uses of a canonical reference from the given references map.
 * @param refs - Map of reference records.
 * @param canonical - The canonical reference record to aggregate uses for.
 * @returns Sorted array of reference uses.
 */
function aggregateUses(refs: Map<RefKey, RefRecord>, canonical: RefRecord): RefUseInternal[] {
	const collected: RefUseInternal[] = [];
	refIterator(refs).forEach((ref) => {
		if ((ref.canonical ?? ref) === canonical) {
			collected.push(...ref.uses);
		}
	});
	collected.sort((a, b) => a.start - b.start);
	return collected;
}

/**
 * Format a reference name for copying based on user preference.
 * @param name - The reference name to format.
 * @param fmt - The format style: 'raw', 'r' (template), or 'ref' (tag).
 * @returns Formatted string ready for clipboard.
 */
export function formatCopy(name: string, fmt: 'raw' | 'r' | 'ref'): string {
	if (fmt === 'r') return `{{r|${name}}}`;
	if (fmt === 'ref') return `<ref name="${escapeAttr(name)}" />`;
	return name;
}
