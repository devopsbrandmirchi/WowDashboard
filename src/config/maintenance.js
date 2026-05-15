/** When true, the app shows only System Maintenance at / (maintenance branch / staging). */
export const MAINTENANCE_ONLY_MODE =
  import.meta.env.VITE_MAINTENANCE_ONLY === 'true' ||
  import.meta.env.VITE_MAINTENANCE_ONLY === '1';
