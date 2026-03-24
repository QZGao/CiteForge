<template>
	<cdx-dialog v-model:open="open" :title="t('ui.insertCitation.dialog.title', [templateName])"
		:aria-label="t('ui.insertCitation.dialog.title', [templateName])" :id="dialogName" @close="closeDialog">
		<div class="citeforge-insert-dialog">
			<div class="citeforge-insert-dialog__toolbar">
				<div class="citeforge-insert-dialog__toolbar-field">
					<label class="citeforge-insert-dialog__toolbar-label" :for="`${dialogName}-ref-name`">
						{{ t('ui.insertCitation.dialog.refNameLabel') }}
					</label>
					<input :id="`${dialogName}-ref-name`" v-model="refName"
						class="citeforge-insert-input citeforge-insert-dialog__toolbar-input"
						:placeholder="t('ui.insertCitation.dialog.refNamePlaceholder')"
						:aria-label="t('ui.insertCitation.dialog.refNameLabel')" />
				</div>
				<div class="citeforge-insert-dialog__toolbar-actions">
					<span v-if="loadingParams || autoFilling" class="citeforge-insert-dialog__status">{{
						t(autoFilling ? 'ui.insertCitation.dialog.autoFilling' :
							'ui.insertCitation.dialog.loadingParams')
					}}</span>
					<cdx-button weight="quiet" @click.prevent="addNameRow">
						{{ t('ui.insertCitation.dialog.addNames') }}
					</cdx-button>
					<cdx-button weight="quiet" @click.prevent="addParamRow">
						{{ t('ui.insertCitation.dialog.addParam') }}
					</cdx-button>
					<cdx-button weight="quiet" :disabled="autoFilling" @click.prevent="autoFillFromCitoid">
						{{ t('ui.insertCitation.dialog.autoFill') }}
					</cdx-button>
				</div>
			</div>

			<div class="citeforge-insert-dialog__rows">
				<div v-for="row in rows" :key="row.id" class="citeforge-insert-row"
					:class="{ 'citeforge-insert-row--author': row.kind === 'author' }">
					<template v-if="row.kind === 'param'">
						<div class="citeforge-insert-inline-field">
							<input v-model="row.field.name" class="citeforge-insert-input citeforge-insert-input--name"
								:list="paramDatalistId"
								:placeholder="t('ui.insertCitation.dialog.paramNamePlaceholder')"
								:aria-label="t('ui.insertCitation.dialog.paramNameLabel')" />
							<input v-model="row.field.value"
								class="citeforge-insert-input citeforge-insert-input--value"
								:placeholder="t('ui.insertCitation.dialog.paramValuePlaceholder')"
								:aria-label="t('ui.insertCitation.dialog.paramValueLabel')" />
						</div>
						<button class="citeforge-insert-remove" type="button"
							:title="t('ui.insertCitation.dialog.removeParam')" @click.prevent="removeRow(row.id)">
							{{ t('ui.insertCitation.dialog.removeShort') }}
						</button>
					</template>

					<template v-else>
						<div class="citeforge-insert-author-row">
							<button class="citeforge-insert-mode-toggle" type="button"
								:aria-pressed="row.mode === 'single'" :title="row.mode === 'single'
									? t('ui.insertCitation.dialog.expandAuthorFields')
									: t('ui.insertCitation.dialog.collapseAuthorFields')" :aria-label="row.mode === 'single'
										? t('ui.insertCitation.dialog.expandAuthorFields')
										: t('ui.insertCitation.dialog.collapseAuthorFields')"
								@click.prevent="setAuthorMode(row, row.mode !== 'single')">
								<svg v-if="row.mode === 'single'" viewBox="0 0 24 24" stroke-width="2.25"
									stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"
									aria-hidden="true">
									<path d="M17 13l4 -4l-4 -4" />
									<path d="M7 13l-4 -4l4 -4" />
									<path d="M12 14a5 5 0 0 1 5 -5h4" />
									<path d="M12 19v-5a5 5 0 0 0 -5 -5h-4" />
								</svg>
								<svg v-else viewBox="0 0 24 24" stroke-width="2.25" stroke="currentColor" fill="none"
									stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M11 16h10" />
									<path d="M11 16l4 4" />
									<path d="M11 16l4 -4" />
									<path d="M13 8h-10" />
									<path d="M13 8l-4 4" />
									<path d="M13 8l-4 -4" />
								</svg>
							</button>

							<div v-if="row.mode === 'split'"
								class="citeforge-insert-author-fields citeforge-insert-author-fields--split">
								<div class="citeforge-insert-inline-field">
									<input v-model="row.split.last.name"
										class="citeforge-insert-input citeforge-insert-input--name"
										:list="paramDatalistId" aria-label="last1" placeholder="last1" />
									<input v-model="row.split.last.value"
										class="citeforge-insert-input citeforge-insert-input--value"
										:aria-label="t('ui.insertCitation.dialog.lastPlaceholder')"
										:placeholder="t('ui.insertCitation.dialog.lastPlaceholder')" />
								</div>
								<div class="citeforge-insert-inline-field">
									<input v-model="row.split.first.name"
										class="citeforge-insert-input citeforge-insert-input--name"
										:list="paramDatalistId" aria-label="first1" placeholder="first1" />
									<input v-model="row.split.first.value"
										class="citeforge-insert-input citeforge-insert-input--value"
										:aria-label="t('ui.insertCitation.dialog.firstPlaceholder')"
										:placeholder="t('ui.insertCitation.dialog.firstPlaceholder')" />
								</div>
								<div class="citeforge-insert-inline-field">
									<input v-model="row.split.link.name"
										class="citeforge-insert-input citeforge-insert-input--name"
										:list="paramDatalistId" aria-label="author-link1" placeholder="author-link1" />
									<input v-model="row.split.link.value"
										class="citeforge-insert-input citeforge-insert-input--value"
										:aria-label="t('ui.insertCitation.dialog.linkPlaceholder')"
										:placeholder="t('ui.insertCitation.dialog.linkPlaceholder')" />
								</div>
							</div>

							<div v-else class="citeforge-insert-author-fields citeforge-insert-author-fields--single">
								<div class="citeforge-insert-inline-field">
									<input v-model="row.single.author.name"
										class="citeforge-insert-input citeforge-insert-input--name"
										:list="paramDatalistId" aria-label="author1" placeholder="author1" />
									<input v-model="row.single.author.value"
										class="citeforge-insert-input citeforge-insert-input--value"
										:aria-label="t('ui.insertCitation.dialog.authorPlaceholder')"
										:placeholder="t('ui.insertCitation.dialog.authorPlaceholder')" />
								</div>
								<div class="citeforge-insert-inline-field">
									<input v-model="row.single.link.name"
										class="citeforge-insert-input citeforge-insert-input--name"
										:list="paramDatalistId" aria-label="author-link1" placeholder="author-link1" />
									<input v-model="row.single.link.value"
										class="citeforge-insert-input citeforge-insert-input--value"
										:aria-label="t('ui.insertCitation.dialog.linkPlaceholder')"
										:placeholder="t('ui.insertCitation.dialog.linkPlaceholder')" />
								</div>
							</div>

							<button class="citeforge-insert-remove" type="button"
								:title="t('ui.insertCitation.dialog.removeParam')" @click.prevent="removeRow(row.id)">
								{{ t('ui.insertCitation.dialog.removeShort') }}
							</button>
						</div>
					</template>
				</div>
			</div>

			<datalist :id="paramDatalistId">
				<option v-for="param in allParamOptions" :key="param" :value="param"></option>
			</datalist>

			<footer class="citeforge-insert-dialog__actions">
				<cdx-button weight="quiet" @click.prevent="closeDialog">{{ t('ui.default.cancel') }}</cdx-button>
				<cdx-button action="progressive" @click.prevent="insertCitation">
					{{ t('ui.insertCitation.dialog.insertButton') }}
				</cdx-button>
			</footer>
		</div>
	</cdx-dialog>
</template>
