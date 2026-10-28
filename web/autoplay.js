// Browsers only start a video with sound once the viewer has touched the page. Someone opening the shared
// link of a channel or event has not, so the picture starts muted and the player offers «Activar sonido».
export function autoplay(video, play = () => video.play()) {
  const attempt = () => { try { return Promise.resolve(play()); } catch (error) { return Promise.reject(error); } };
  return attempt().catch((error) => {
    if (error?.name !== 'NotAllowedError' || video.muted) throw error;
    video.dataset.autoMuted = '1';
    video.muted = true;
    return attempt().catch((again) => { video.muted = false; throw again; });
  });
}

// The viewer chose the sound themselves: their volume and mute are remembered again.
export function soundChosen(video) {
  delete video.dataset.autoMuted;
}
