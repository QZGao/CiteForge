<!--
  Vue template for the Cite Hub inspector panel component.
-->
<template>
	<div class="citehub-shell" v-if="visible">
		<button
			class="citehub-launcher"
			v-if="!open"
			type="button"
			@click.prevent="open = true"
			title="Open Cite Hub"
		>
			<span class="citehub-launcher__icon">✎</span>
			<span class="citehub-launcher__label">Citations</span>
		</button>

		<div class="citehub-panel" :class="{ 'is-open': open }">
			<div class="citehub-panel__header">
				<div class="citehub-panel__title">Cite Hub – Inspector</div>
				<div class="citehub-panel__actions">
					<cdx-button weight="quiet" size="small" @click.prevent="closeDialog">
						Collapse
					</cdx-button>
				</div>
			</div>
			<div class="citehub-panel__body">
				<div class="citehub-panel__index">
					<button
						v-for="letter in ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '*']"
						:key="letter"
						type="button"
						class="citehub-index-btn"
						:disabled="!firstByBucket[letter]"
						@click.prevent="scrollToBucket(letter)"
					>
						{{ letter }}
					</button>
				</div>
				<div class="citehub-panel__list">
					<div class="citehub-list-topbar">
						<input
							class="citehub-search"
							type="search"
							:placeholder="'Search citations…'"
							:aria-label="'Search citations'"
							:value="query"
							@input="onQueryInput"
						/>
						<cdx-button
							weight="quiet"
							size="small"
							:title="'Refresh'"
							:aria-label="'Refresh'"
							@click.prevent="refreshList"
						>
							<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
								<path fill="currentColor" d="M15.65 4.35A8 8 0 1 0 17.4 13h-2.22a6 6 0 1 1-1-7.22L11 9h7V2z"/>
							</svg>
						</cdx-button>
					</div>
					<div v-if="hasRefs" class="citehub-list-wrap">
						<div
							v-for="(ref, idx) in filteredRefs"
							:key="ref.id || idx"
							:id="idx === 0 || bucketFor(filteredRefs[idx - 1]) !== bucketFor(ref) ? 'citehub-anchor-' + bucketFor(ref) : null"
							class="citehub-row"
							:class="{ 'is-selected': selectedRef && selectedRef.id === ref.id }"
							@click.prevent="selectRef(ref)"
						>
							<div class="citehub-row__title">
								<span class="citehub-row__name">{{ refName(ref) }}</span>
								<span class="citehub-row__name-actions" v-if="ref.name">
									<button class="citehub-icon-btn" type="button" @click.stop.prevent="editRefName(ref)" title="Edit ref name">
										<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
											<path fill="currentColor" d="m16.77 8 1.94-2a1 1 0 0 0 0-1.41l-3.34-3.3a1 1 0 0 0-1.41 0L12 3.23zM1 14.25V19h4.75l9.96-9.96-4.75-4.75z"/>
										</svg>
									</button>
									<button class="citehub-icon-btn" type="button" @click.stop.prevent="copyRefName(ref)" title="Copy ref name">
										<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
											<path fill="currentColor" d="M3 3h8v2h2V3c0-1.1-.895-2-2-2H3c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h2v-2H3z"/>
											<path fill="currentColor" d="M9 9h8v8H9zm0-2c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h8c1.1 0 2-.895 2-2V9c0-1.1-.895-2-2-2z"/>
										</svg>
									</button>
								</span>
								<span class="citehub-row__meta">Uses: {{ refUses(ref) }} <span v-if="ref.group">· {{ ref.group }}</span></span>
							</div>
							<div class="citehub-row__snippet">{{ (ref.contentWikitext || '').slice(0, 200) || '(No inline content captured)' }}</div>
							<div class="citehub-row__actions">
								<button class="citehub-copy-btn" type="button" @click.stop.prevent="copyRefContent(ref)" title="Copy raw content">
									<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
										<path fill="currentColor" d="M3 3h8v2h2V3c0-1.1-.895-2-2-2H3c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h2v-2H3z"/>
										<path fill="currentColor" d="M9 9h8v8H9zm0-2c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h8c1.1 0 2-.895 2-2V9c0-1.1-.895-2-2-2z"/>
									</svg>
									<span>Copy raw</span>
								</button>
							</div>
						</div>
					</div>
					<div v-else class="citehub-empty">No references found on this page.</div>
				</div>
				<div class="citehub-panel__toolbar">
					<button v-if="hasPendingChanges" class="citehub-tool-btn citehub-tool-btn--primary" type="button" title="Save pending changes" @click.prevent="saveChanges">
						<span class="citehub-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16">
								<path fill="currentColor" d="M17 2h-3.5V1H15V0H5v1h1.5v1H3L2 4v15h16V4zm-2.5 0h-9V1h9zM7 15H5v-4h2zm4 0H9v-4h2zm4 0h-2v-4h2zm2-6H3V4.5l.5-.5h13l.5.5z"/>
							</svg>
						</span>
						<span class="citehub-tool-label">Save ({{ pendingChanges.length }})</span>
					</button>
					<button class="citehub-tool-btn" type="button" title="Settings" @click.prevent="toggleSettings">
						<span class="citehub-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16" xmlns:xlink="http://www.w3.org/1999/xlink">
								<g transform="translate(10 10)">
									<path fill="currentColor" id="a" d="M1.5-10h-3l-1 6.5h5m0 7h-5l1 6.5h3"/>
									<use xlink:href="#a" transform="rotate(45)" fill="currentColor"/>
									<use xlink:href="#a" transform="rotate(90)" fill="currentColor"/>
									<use xlink:href="#a" transform="rotate(135)" fill="currentColor"/>
								</g>
								<path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0 0 15 7.5 7.5 0 0 0 0-15v4a3.5 3.5 0 0 1 0 7 3.5 3.5 0 0 1 0-7"/>
							</svg>
						</span>
						<span class="citehub-tool-label">Settings</span>
					</button>
					<button class="citehub-tool-btn" type="button" title="Mass rename (soon)">
						<span class="citehub-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16">
								<path fill="currentColor" d="M6 3H5V1h1c.768 0 1.47.289 2 .764A3 3 0 0 1 10 1h1v2h-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h1v2h-1c-.768 0-1.47-.289-2-.764A3 3 0 0 1 6 19H5v-2h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1m6 12h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-6v2h6v6h-6zm-8-2v2H2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2v2H2v6z"/>
							</svg>
						</span>
						<span class="citehub-tool-label">Mass rename</span>
					</button>
					<button class="citehub-tool-btn" type="button" title="Structure tools (soon)">
						<span class="citehub-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16">
								<path fill="currentColor" d="M7 15h12v2H7zm0-6h12v2H7zm0-6h12v2H7zM2 6h1V1H1v1h1zm1 9v1H2v1h1v1H1v1h3v-5H1v1zM1 8v1h2v1H1.5a.5.5 0 0 0-.5.5V13h3v-1H2v-1h1.5a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5z"/>
							</svg>
						</span>
						<span class="citehub-tool-label">Structure</span>
					</button>
					<button class="citehub-tool-btn" type="button" title="Checks (soon)">
						<span class="citehub-tool-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20" width="16" height="16">
								<path fill="currentColor" d="m.29 12.71 1.42-1.42 2.22 2.22 8.3-10.14 1.54 1.26-9.7 11.86zM12 10h5v2h-5zm-3 4h5v2H9zm6-8h5v2h-5z"/>
							</svg>
						</span>
						<span class="citehub-tool-label">Checks</span>
					</button>
				</div>
				<div
					class="citehub-settings"
					v-if="showSettings"
				>
					<div class="citehub-settings__title">Cite Hub Settings</div>
					<label class="citehub-settings__row">
						<span>Copy format</span>
						<select v-model="settings.copyFormat">
							<option value="raw">raw name</option>
							<option value="r">{{ '{' }}{r|name}}</option>
							<option value="ref">&lt;ref name="name" /&gt;</option>
						</select>
					</label>
					<label class="citehub-settings__row">
						<input type="checkbox" v-model="settings.showCiteRefCopyBtn" />
						<span>Show citation hover copy popup</span>
					</label>
					<label class="citehub-settings__row">
						<input type="checkbox" v-model="settings.showInUserNs" />
						<span>Enable in User namespace</span>
					</label>
					<div class="citehub-settings__actions">
						<cdx-button weight="quiet" size="small" @click.prevent="saveSettings">
							Save
						</cdx-button>
						<cdx-button weight="quiet" size="small" @click.prevent="toggleSettings">
							Close
						</cdx-button>
					</div>
				</div>
			</div>
			<div class="citehub-resizer" @mousedown.prevent="startResize"></div>
		</div>
	</div>
</template>
