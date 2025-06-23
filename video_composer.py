import sys
import os
import json
from moviepy import VideoFileClip, concatenate_videoclips

def load_input(json_path):
    with open(json_path, 'r') as f:
        return json.load(f)

def main():
    if len(sys.argv) < 2:
        print("Missing input JSON argument.")
        sys.exit(1)

    input_json_path = sys.argv[1]
    data = load_input(input_json_path)

    clips_info = data['clips']
    video_index = data['index']

    output_path = os.path.join("output", f"final_video_{video_index}.mp4")
    os.makedirs("output", exist_ok=True)

    print(f"Composing video {video_index} from {len(clips_info)} pre-processed clips...")

    TARGET_RES = (1920, 1080)  # Target resolution for the final video
    clips = []
    for i, clip in enumerate(clips_info):
        print(f"Loading clip {i+1}: {clip['filePath']}")
        video = VideoFileClip(os.path.normpath(clip['filePath'])).with_fps(30)
        
        resized = video.resized(new_size=TARGET_RES)
        clips.append(resized)

    final_video = concatenate_videoclips(clips, method="compose")
    final_video.write_videofile(
        output_path,
        codec="libx264",
        audio_codec="aac",
        bitrate="16000k",
        threads=4,
        fps=30,
        preset="medium",
    )

    print(f"Final video created: {output_path}")

     # Create a description file with credit links
    description_path = os.path.join("output", f"description_{video_index}.txt")
    with open(description_path, 'w', encoding='utf-8') as f:
        f.write("Clip Credits:\n\n")
        for i, clip in enumerate(clips_info):
            line = f"{i + 1}. {clip['broadcaster']} — {clip.get('url', 'URL not provided')}\n"
            f.write(line)

    print(f"Description file created: {description_path}") 


if __name__ == "__main__":
    main()
