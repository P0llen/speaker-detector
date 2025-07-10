from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from build import main as run_build
import time
import os

class ComponentChangeHandler(FileSystemEventHandler):
    def on_any_event(self, event):
        if event.src_path.endswith((".html", ".css", ".js")):
            print(f"🔄 Change detected: {event.src_path}")
            run_build()

if __name__ == "__main__":
    path = "speaker_detector/web/static/components"
    observer = Observer()
    observer.schedule(ComponentChangeHandler(), path=path, recursive=True)
    observer.start()

    print("👀 Watching component folders for changes...")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
