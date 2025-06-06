import { useState, useEffect } from "react";
import type { Settings as ScreenpipeAppSettings } from "@screenpipe/js";
import {
	getScreenpipeAppSettings,
	updateScreenpipeAppSettings,
} from "@/lib/actions/get-screenpipe-app-settings";
import { Settings as PipeSettingsFromTypes } from "@/lib/types";
import { settingsStore, PipeSettings } from "@/lib/store/settings-store";

export function useSettings() {
	const [settings, setSettings] =
		useState<Partial<ScreenpipeAppSettings> | null>(
			settingsStore.getStore().globalSettings,
		);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const loadSettings = async () => {
			setLoading(true);
			await settingsStore.loadGlobalSettings();
			setLoading(false);
		};

		loadSettings();

		const unsubscribe = settingsStore.subscribe(() => {
			setSettings(settingsStore.getStore().globalSettings);
		});

		return () => {
			unsubscribe();
		};
	}, []);

	const updateSettings = async (
		newSettings: Partial<ScreenpipeAppSettings>,
	) => {
		return settingsStore.updateGlobalSettings(newSettings);
	};

	return { settings, updateSettings, loading };
}
