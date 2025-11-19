import sys
import os
import json
from moviepy import VideoFileClip, concatenate_videoclips

def load_input(json_path):
    with open(json_path, 'r') as f:
        return json.load(f)

def load_master_json(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_master_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

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

    TARGET_RES = (1920, 1080)
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

    # ---------------------------
    # Build combined JSON content
    # ---------------------------
    
    # Build description text
    # In future we make this more dynamic loading in a template file or similar
    description_lines = ["If you don’t want your clip featured in future videos, just shoot an email to twitchclipcomps@gmail.com \n\nIf you enjoyed the video, don’t forget to like and subscribe for more iRacing action every day! \n\nClip Credits:\n"]
    for i, clip in enumerate(clips_info):
        line = f"{i + 1}. {clip['broadcaster']} — {clip.get('url', 'URL not provided')}"
        description_lines.append(line)

    description_text = "\n".join(description_lines)

    # Select first thumbnail
    first_thumbnail = clips_info[0].get('thumbnail', 'No thumbnail') if clips_info else "No thumbnail"

    # Build data for this video entry
    entry = {
        "description": description_text,
        "thumbnail": first_thumbnail
    }

    # Load existing master JSON and update it
    master_json_path = os.path.join("output", "videos_data.json")
    master_data = load_master_json(master_json_path)

    master_data[f"video_{video_index}"] = entry

    # Save back to one single file
    save_master_json(master_json_path, master_data)

    print(f"Updated master JSON file: {master_json_path}")


if __name__ == "__main__":
    main()
