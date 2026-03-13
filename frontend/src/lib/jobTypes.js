/**
 * Single source of truth for job type parameter metadata.
 * Used by Add Job modal (Queue) and Job Scheduler form.
 */

export const JOB_TYPES = [
  "download_video",
  "get_metadata",
  "fill_missing_metadata",
  "queue_all_downloads",
  "download_channel_artwork",
  "download_one_channel",
  "download_auto_enabled_channels",
  "update_channel_info",
  "add_video_from_frontend",
  "add_video_from_playlist",
  "transcode_video_for_ipad",
  "trim_job_queue",
];

/** @typedef {"required" | "optional" | null} VideoIdRequirement */
/** @typedef {"required" | "optional" | null} ChannelIdRequirement */
/** @typedef {{ required: boolean; label: string; placeholder?: string; min?: number; inputType?: "number" | "text" }} ParameterConfig */

/**
 * @typedef {Object} JobTypeConfig
 * @property {boolean} implemented
 * @property {VideoIdRequirement} video_id - "required" | "optional" | null
 * @property {ChannelIdRequirement} channel_id - "required" | "optional" | null
 * @property {ParameterConfig | null} parameter
 */

/** @type {Record<string, JobTypeConfig>} */
export const JOB_TYPE_CONFIG = {
  download_video: {
    implemented: true,
    video_id: "required",
    channel_id: null,
    parameter: null,
  },
  get_metadata: {
    implemented: true,
    video_id: "required",
    channel_id: null,
    parameter: null,
  },
  fill_missing_metadata: {
    implemented: true,
    video_id: null,
    channel_id: null,
    parameter: {
      required: false,
      label: "Max videos",
      placeholder: "optional, default 1",
      inputType: "number",
    },
  },
  download_channel_artwork: {
    implemented: true,
    video_id: null,
    channel_id: "required",
    parameter: null,
  },
  download_one_channel: {
    implemented: true,
    video_id: null,
    channel_id: "required",
    parameter: {
      required: false,
      label: "Max videos",
      placeholder: "optional",
      inputType: "number",
    },
  },
  download_auto_enabled_channels: {
    implemented: true,
    video_id: null,
    channel_id: null,
    parameter: null,
  },
  update_channel_info: {
    implemented: true,
    video_id: null,
    channel_id: "required",
    parameter: null,
  },
  add_video_from_frontend: {
    implemented: true,
    video_id: null,
    channel_id: null,
    parameter: {
      required: true,
      label: "YouTube URL or video ID",
      placeholder: "e.g. https://youtube.com/watch?v=...",
      inputType: "text",
    },
  },
  add_video_from_playlist: {
    implemented: true,
    video_id: null,
    channel_id: null,
    parameter: {
      required: true,
      label: "YouTube URL or video ID",
      placeholder: "e.g. https://youtube.com/watch?v=...",
      inputType: "text",
    },
  },
  transcode_video_for_ipad: {
    implemented: false,
    video_id: "required",
    channel_id: null,
    parameter: null,
  },
  queue_all_downloads: {
    implemented: true,
    video_id: null,
    channel_id: null,
    parameter: null,
  },
  trim_job_queue: {
    implemented: true,
    video_id: null,
    channel_id: null,
    parameter: {
      required: true,
      label: "Age (days)",
      placeholder: "e.g. 7",
      min: 3,
      inputType: "number",
    },
  },
};

/**
 * @param {string} jobType
 * @returns {JobTypeConfig}
 */
export function getJobTypeConfig(jobType) {
  return JOB_TYPE_CONFIG[jobType] ?? {
    implemented: true,
    video_id: null,
    channel_id: null,
    parameter: null,
  };
}

/**
 * @param {string} jobType
 * @returns {boolean}
 */
export function jobTypeUsesVideoId(jobType) {
  const cfg = getJobTypeConfig(jobType);
  return cfg.video_id === "required" || cfg.video_id === "optional";
}

/**
 * @param {string} jobType
 * @returns {"required" | "optional" | null}
 */
export function getVideoIdRequirement(jobType) {
  return getJobTypeConfig(jobType).video_id ?? null;
}

/**
 * @param {string} jobType
 * @returns {boolean}
 */
export function jobTypeUsesChannelId(jobType) {
  const cfg = getJobTypeConfig(jobType);
  return cfg.channel_id === "required" || cfg.channel_id === "optional";
}

/**
 * @param {string} jobType
 * @returns {"required" | "optional" | null}
 */
export function getChannelIdRequirement(jobType) {
  return getJobTypeConfig(jobType).channel_id ?? null;
}

/**
 * @param {string} jobType
 * @returns {ParameterConfig | null}
 */
export function getParameterConfig(jobType) {
  return getJobTypeConfig(jobType).parameter ?? null;
}

/**
 * @param {string} jobType
 * @returns {boolean}
 */
export function isJobTypeImplemented(jobType) {
  return getJobTypeConfig(jobType).implemented;
}

/**
 * Validate form values for a job type. Returns an error message string or null if valid.
 * @param {string} jobType
 * @param {{ video_id?: string; channel_id?: string; parameter?: string }} values
 * @returns {string | null}
 */
export function validateJobParams(jobType, values) {
  const config = getJobTypeConfig(jobType);
  if (!config.implemented) {
    return "This job type is not implemented yet.";
  }
  if (config.video_id === "required") {
    const v = String(values.video_id ?? "").trim();
    if (!v) return "Video ID is required.";
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 1) return "Video ID must be a positive number.";
  }
  if (config.channel_id === "required") {
    const c = String(values.channel_id ?? "").trim();
    if (!c) return "Channel is required.";
    const n = parseInt(c, 10);
    if (Number.isNaN(n) || n < 1) return "Channel must be selected.";
  }
  const paramConfig = config.parameter;
  if (paramConfig) {
    if (paramConfig.required) {
      const p = String(values.parameter ?? "").trim();
      if (!p) return `${paramConfig.label} is required.`;
      if (paramConfig.min != null) {
        const n = parseInt(p, 10);
        if (Number.isNaN(n) || n < paramConfig.min) {
          return `${paramConfig.label} must be at least ${paramConfig.min}.`;
        }
      }
    }
  }
  return null;
}
