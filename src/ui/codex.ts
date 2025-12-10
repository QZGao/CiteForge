/**
 * Load Codex and Vue from ResourceLoader. Mirrors ReviewTool pattern for future UI work.
 */
export function loadCodex(): Promise<{ Vue: unknown; Codex: unknown }> {
	return new Promise((resolve, reject) => {
		mw.loader
			.using('@wikimedia/codex')
			.then((requireFn: (name: string) => unknown) => {
				resolve({
					Vue: requireFn ? requireFn('vue') : null,
					Codex: requireFn ? requireFn('@wikimedia/codex') : null
				});
			})
			.catch((err: unknown) => {
				const reason =
					err instanceof Error
						? err
						: new Error(
								typeof err === 'string'
									? err
									: (() => {
											try {
												return JSON.stringify(err);
											} catch {
												return 'Unknown error';
											}
									  })()
						  );
				reject(reason);
			});
	});
}
