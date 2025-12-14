<template>
	<div class="citeforge-mass-rename-shell" v-if="open">
		<div class="citeforge-mass-rename-backdrop" @click="closeDialog"></div>
		<div class="citeforge-mass-rename-window" role="dialog" aria-modal="true" :aria-label="t('ui.massRename.dialog.title')">
			<header class="citeforge-mass-rename-header">
				<div>
					<div class="citeforge-mass-rename-title">{{ t('ui.massRename.dialog.title') }}</div>
						<div class="citeforge-mass-rename-subtitle">{{ t('ui.massRename.dialog.subtitle') }}</div>
				</div>
				<div class="citeforge-mass-rename-header-actions">
					<cdx-button weight="quiet" size="small" @click.prevent="closeDialog">{{ t('ui.default.close') }}</cdx-button>
				</div>
			</header>
			<div class="citeforge-mass-rename-body">
				<section class="citeforge-mass-rename-controls">
					<cdx-field class="citeforge-mass-rename-field">
						<cdx-multiselect-lookup
							v-model:input-chips="fieldChips"
							v-model:selected="fieldSelection"
							v-model:input-value="fieldInput"
							:menu-items="fieldMenuItems"
							:menu-config="fieldMenuConfig"
							:placeholder="t('ui.massRename.dialog.addNamingPartsPlaceholder')"
							@input="onFieldInput"
							@update:selected="onFieldSelection"
						>
							<template #no-results>
								{{ t('ui.massRename.dialog.noMatchingFields') }}
							</template>
						</cdx-multiselect-lookup>
						<template #label>
							{{ t('ui.massRename.dialog.namingPartsLabel') }}
						</template>
						<template #description>
							{{ t('ui.massRename.dialog.namingPartsDescription') }}
						</template>
					</cdx-field>
					<div class="citeforge-mass-rename-rowstack">
						<span class="citeforge-mass-rename-label">{{ t('ui.massRename.dialog.collisionSuffix') }}</span>
						<cdx-select
							class="citeforge-mass-rename-select"
							:menu-items="incrementOptions"
							v-model:selected="config.incrementStyle"
						/>
					</div>
					<div class="citeforge-mass-rename-rowstack">
						<span class="citeforge-mass-rename-label">{{ t('ui.massRename.dialog.delimiter') }}</span>
						<cdx-text-input
							class="citeforge-mass-rename-input"
							v-model="config.delimiter"
							:aria-label="t('ui.massRename.dialog.delimiter')"
						/>
						<cdx-checkbox v-model="config.delimiterConditional">
							{{ t('ui.massRename.dialog.delimiterConditional') }}
						</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-rowstack">
						<span class="citeforge-mass-rename-label">{{ t('ui.massRename.dialog.spaceReplacement') }}</span>
						<cdx-text-input
							class="citeforge-mass-rename-input"
							v-model="config.replaceSpaceWith"
							placeholder="_"
							:aria-label="t('ui.massRename.dialog.spaceReplacement')"
						/>
					</div>
					<div class="citeforge-mass-rename-rowstack citeforge-mass-rename-rowstack--wrap">
						<cdx-checkbox v-model="config.convertYearDigits">{{ t('ui.massRename.dialog.convertYearDigits') }}</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-rowstack citeforge-mass-rename-rowstack--wrap">
						<cdx-checkbox v-model="config.lowercase">{{ t('ui.massRename.dialog.lowercase') }}</cdx-checkbox>
						<cdx-checkbox v-model="config.stripDiacritics">{{ t('ui.massRename.dialog.stripDiacritics') }}</cdx-checkbox>
						<cdx-checkbox v-model="config.stripPunctuation">{{ t('ui.massRename.dialog.stripPunctuation') }}</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-actions">
						<cdx-button size="small" weight="quiet" @click.prevent="regenerateSuggestions(true)">
							{{ t('ui.massRename.dialog.regenerate') }}
						</cdx-button>
						<cdx-button size="small" weight="quiet" @click.prevent="resetAll">
							{{ t('ui.massRename.dialog.reset') }}
						</cdx-button>
					</div>
				</section>
				<section class="citeforge-mass-rename-list">
					<div class="citeforge-mass-rename-toolbar">
						<input
							type="search"
							class="citeforge-mass-rename-search"
							:placeholder="t('ui.massRename.dialog.filterPlaceholder')"
							:value="query"
							@input="onQueryInput"
						/>
						<cdx-checkbox v-model="showInactive">
							{{ t('ui.massRename.dialog.showUnselected') }}
						</cdx-checkbox>
					</div>
					<div class="citeforge-mass-rename-table">
						<div class="citeforge-mass-rename-row citeforge-mass-rename-head">
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--check">
									<cdx-checkbox
										:indeterminate="selectAllIndeterminate"
										:model-value="selectAllChecked"
										@update:model-value="onToggleAll"
										:aria-label="t('ui.massRename.dialog.selectAllAria')"
									/>
							</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--name">{{ t('ui.massRename.dialog.colReference') }}</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--uses">{{ t('ui.massRename.dialog.colUses') }}</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--suggest">{{ t('ui.massRename.dialog.colSuggestedName') }}</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--actions"></div>
						</div>
						<div
							v-for="row in filteredRows"
							:key="row.ref.id"
							class="citeforge-mass-rename-row"
							:class="{ 'is-inactive': !row.active, 'has-error': !!row.error }"
						>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--check">
								<cdx-checkbox v-model="row.active" @change="onToggleRow(row)" />
							</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--name">
								<div class="citeforge-mass-rename-name">
									<span class="citeforge-mass-rename-name__label">{{ row.ref.name || t('ui.default.nameless') }}</span>
									<span class="citeforge-mass-rename-name__bucket">{{ bucketFor(row) }}</span>
								</div>
								<div class="citeforge-mass-rename-snippet">{{ row.snippet || t('ui.massRename.dialog.noInlineContent') }}</div>
								<div class="citeforge-mass-rename-meta">
									<span
										v-if="row.metadata.author || row.metadata.last || row.metadata.first"
										class="citeforge-mass-rename-chip"
									>
										{{ t('ui.massRename.dialog.metaAuthor') }}
										{{
											row.metadata.author ||
												[row.metadata.first, row.metadata.last].filter(Boolean).join(' ') ||
												row.metadata.last
										}}
									</span>
									<span v-if="row.metadata.title" class="citeforge-mass-rename-chip">{{ t('ui.massRename.dialog.metaTitle') }} {{ row.metadata.title }}</span>
									<span v-if="row.metadata.work" class="citeforge-mass-rename-chip">{{ t('ui.massRename.dialog.metaWork') }} {{ row.metadata.work }}</span>
									<span v-if="row.metadata.domain" class="citeforge-mass-rename-chip">{{ t('ui.massRename.dialog.metaWebsite') }} {{ row.metadata.domain }}</span>
									<span
										v-if="row.metadata.dateDisplay || row.metadata.year || row.metadata.textYear"
										class="citeforge-mass-rename-chip"
									>
										{{ t('ui.massRename.dialog.metaDate') }} {{ row.metadata.dateDisplay || row.metadata.year || row.metadata.textYear }}
									</span>
								</div>
							</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--uses">{{ row.ref.uses.length }}</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--suggest">
								<cdx-text-input
									:disabled="!row.active"
									:model-value="row.suggestion"
									@update:model-value="onSuggestionEdited(row, $event)"
									:aria-label="t('ui.massRename.dialog.suggestedAria')"
								/>
								<div class="citeforge-mass-rename-error" v-if="row.error">{{ row.error }}</div>
							</div>
							<div class="citeforge-mass-rename-col citeforge-mass-rename-col--actions">
								<cdx-button size="small" weight="quiet" @click.prevent="regenerateRow(row)" :disabled="!row.active">
									{{ t('ui.massRename.dialog.reapply') }}
								</cdx-button>
							</div>
						</div>
						<div v-if="!filteredRows.length" class="citeforge-mass-rename-empty">
							{{ t('ui.massRename.dialog.noMatches') }}
						</div>
					</div>
				</section>
			</div>
			<footer class="citeforge-mass-rename-footer">
					<div class="citeforge-mass-rename-status">
						<span>{{ t('ui.massRename.dialog.footerSelected', [activeCount]) }}</span>
						<span v-if="hasConflicts">· {{ t('ui.massRename.dialog.footerConflicts', [conflictCount]) }}</span>
					</div>
				<div class="citeforge-mass-rename-footer-actions">
						<cdx-button weight="quiet" @click.prevent="closeDialog">{{ t('ui.default.cancel') }}</cdx-button>
						<cdx-button weight="primary" :disabled="applyDisabled" @click.prevent="applyRenames">
							{{ t('ui.massRename.dialog.sendToInspector') }}
						</cdx-button>
				</div>
			</footer>
		</div>
	</div>
</template>
