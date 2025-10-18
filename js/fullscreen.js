// Fullscreen Listeners
(() => {
	const targetElement = document.body;
	const isIOs = /iPad|iPod|iPhone/i.test(navigator.userAgent);
	const isAndroid = /Android/i.test(navigator.userAgent);
	const targetEventName = (isIOs) ? "touchend" : "mouseup";
	const requestFullscreenPolyfill = (
			targetElement.requestFullscreen ||
			targetElement.msRequestFullscreen ||
			targetElement.mozRequestFullScreen ||
			targetElement.webkitRequestFullscreen
		),
		exitFullscreenPolyfill = (
			document.exitFullscreen ||
			document.msExitFullscreen ||
			document.mozCancelFullScreen ||
			document.webkitExitFullscreen
		);

	const ListenerFullScreen = async () => {
		try {
			await requestFullscreenPolyfill.call(targetElement)
		} catch (e) {
			console.error(e)
		}
	}
	const ListenerFullScreenChange = () => {
		if (!!(document.fullscreenElement ||
			document.msFullscreenElement ||
			document.mozFullScreenElement ||
			document.webkitFullscreenElement
		)) {
			targetElement.removeEventListener(targetEventName, ListenerFullScreen);
			document.addEventListener('fullscreenchange', ListenerFullScreenChange);
		} else {
			targetElement.addEventListener(targetEventName, ListenerFullScreen);
			document.removeEventListener('fullscreenchange', ListenerFullScreenChange);
		}
	}

	if ((isAndroid || isIOs) && !!requestFullscreenPolyfill) {
		targetElement.addEventListener(targetEventName, ListenerFullScreen);
		document.addEventListener('fullscreenchange', ListenerFullScreenChange);
	}
})()