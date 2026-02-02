<template>
	<cdx-dialog v-model:open="open" :title="t('ui.extract.dialog.title')"
		:aria-label="t('ui.extract.dialog.title')" :id="dialogName" @close="closeDialog">
		<div class="citeforge-extract-dialog">
			<div class="citeforge-extract-field">
				<label class="citeforge-extract-label" for="citeforge-extract-input">
					{{ t('ui.extract.dialog.inputLabel') }}
				</label>
				<cdx-text-area id="citeforge-extract-input" :rows="8"
					:placeholder="t('ui.extract.dialog.inputPlaceholder')" :model-value="inputText"
					@update:model-value="onInput" />
			</div>
			<div class="citeforge-extract-field">
				<label class="citeforge-extract-label" for="citeforge-extract-output">
					{{ t('ui.extract.dialog.outputLabel') }}
				</label>
				<cdx-text-area id="citeforge-extract-output" :rows="10" :model-value="outputText" readonly />
			</div>
			<div class="citeforge-extract-actions">
				<cdx-button action="progressive" @click="extract">
					{{ t('ui.extract.dialog.extractButton') }}
				</cdx-button>
				<cdx-button weight="quiet" @click="closeDialog">
					{{ t('ui.default.close') }}
				</cdx-button>
			</div>
		</div>
	</cdx-dialog>
</template>
