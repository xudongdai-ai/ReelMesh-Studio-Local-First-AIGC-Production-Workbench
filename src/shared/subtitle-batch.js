export function subtitleStem(filename) {
  return String(filename || "").replace(/\.[^.]+$/, "").trim();
}

function episodeNumber(stem) {
  return stem.match(/^\s*(?:第)?(\d+)(?:\s*集)?(?:[._-]\d+)?(?:\s*[上中下])?$/u)?.[1] || null;
}

export function matchSubtitleBatch(videoFiles, subtitleItems) {
  const sources = subtitleItems.filter((item) => item.cues?.length);
  const used = new Set();
  const videos = videoFiles.map((videoFile, index) => {
    const name = subtitleStem(videoFile.name);
    const sourceIndex = sources.findIndex((source, position) => !used.has(position)
      && subtitleStem(source.subtitleFile?.name || source.name) === name);
    if (sourceIndex >= 0) used.add(sourceIndex);
    return { videoFile, name, sourceIndex, index };
  });

  for (const video of videos.filter((item) => item.sourceIndex < 0)) {
    const episode = episodeNumber(video.name);
    if (!episode) continue;
    const matchingVideos = videos.filter((item) => item.sourceIndex < 0 && episodeNumber(item.name) === episode);
    const matchingSources = sources.map((source, index) => ({ source, index }))
      .filter(({ source, index }) => !used.has(index) && episodeNumber(subtitleStem(source.subtitleFile?.name || source.name)) === episode);
    if (matchingVideos.length === 1 && matchingSources.length === 1) {
      video.sourceIndex = matchingSources[0].index;
      video.matchedByEpisode = true;
      used.add(video.sourceIndex);
    }
  }

  return {
    items: videos.map((video) => {
      const source = sources[video.sourceIndex];
      const sourceName = source?.subtitleFile?.name || source?.fileName || "";
      return {
        id: source?.id || `subtitle-${Date.now()}-${video.index}`,
        name: video.name,
        fileName: video.videoFile.name,
        videoFile: video.videoFile,
        subtitleFile: source?.subtitleFile || null,
        cues: source?.cues || [],
        status: !source ? "缺少字幕" : video.matchedByEpisode ? `按集数匹配：${sourceName}` : "视频与字幕已匹配",
      };
    }),
    unmatchedSubtitles: sources.filter((_source, index) => !used.has(index)).map((source) => source.subtitleFile?.name || source.fileName || source.name),
  };
}
