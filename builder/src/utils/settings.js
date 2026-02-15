/**
 * settings オブジェクトから theme プロパティを除外する
 * @param {object} settings
 * @returns {object}
 */
export const omitThemeSetting = (settings) => {
  if (!settings || typeof settings !== "object") return {};
  const { theme, ...rest } = settings;
  return rest;
};
