import { useOmniFit } from "../app/context";

// Camera: outfit photos, Style Scan selfies and Body Scan (with a timer)
export default function CameraModal() {
  const { cameraOpen, cameraReady, setCameraReady, photoError, cameraPurpose, countdown, videoRef, closeCamera, capturePhoto, startCountdown } = useOmniFit();

  return (
    <>
      {cameraOpen && (

        <div
          className="camera-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeCamera();
            }
          }}
        >

          <div
            className="camera-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-title"
          >

            <div className="camera-header">

              <div>
                <h2 id="camera-title">
                  {{ scan: "Style Scan", body: "Body Scan" }[cameraPurpose] || "Take a Picture"}
                </h2>

                <p>
                  {{
                    scan: "Face the camera in good light; keep your whole face in view.",
                    body: "Prop the phone at waist height, step back 2–3 m, head to feet in view.",
                  }[cameraPurpose] || "Position your outfit inside the frame."}
                </p>
              </div>

              <button
                type="button"
                className="close-camera"
                onClick={closeCamera}
                aria-label="Close camera"
              >
                ×
              </button>

            </div>


            {/* CAMERA PREVIEW */}

            <div className="camera-preview">

              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedData={() => setCameraReady(true)}
              />

              <div className="camera-frame" aria-hidden="true">
                <span /><span /><span /><span />
              </div>

              {!cameraReady && (
                <div className="camera-loading">
                  <span className="spinner" />
                  Starting camera…
                </div>
              )}

              {countdown > 0 && (
                <div className="camera-countdown" aria-live="assertive">{countdown}</div>
              )}

            </div>

            {photoError && (
              <p
                className="inline-error on-dark"
                role="alert"
              >
                {photoError}
              </p>
            )}


            {/* CAMERA CONTROLS */}

            <div className="camera-controls">

              <button
                type="button"
                className="ghost-button"
                onClick={closeCamera}
              >
                Cancel
              </button>

              <button
                type="button"
                className="shutter-button"
                onClick={cameraPurpose === "body" ? startCountdown : capturePhoto}
                disabled={!cameraReady || countdown > 0}
                aria-label={cameraPurpose === "body" ? "Capture in 5 seconds" : "Capture photo"}
              >
                <span />
              </button>

              {cameraPurpose === "body" ? (
                <span className="camera-hint-text">Takes the photo 5 s after you tap</span>
              ) : (
                <span className="camera-controls-spacer" />
              )}

            </div>

          </div>

        </div>

      )}
    </>
  );
}
