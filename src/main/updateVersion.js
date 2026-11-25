import semver from 'semver';

export function getUpdateInfo(currentVersion, releaseText) {
  const parse = value => typeof value === 'string' && value.length <= 256 ? semver.valid(value.trim()) : null;
  const current = parse(currentVersion);
  const latest = parse(releaseText);
  if (!current) throw new Error('当前应用版本号无效');
  if (!latest) throw new Error('更新服务返回的版本号无效');
  return { currentVersion: current, latestVersion: latest, hasUpdate: semver.gt(latest, current) };
}
