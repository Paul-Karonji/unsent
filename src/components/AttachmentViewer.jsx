import { useState, useEffect } from 'react';
import { get, set } from 'idb-keyval';
import { supabase } from '../lib/supabase';
import { clickableProps } from '../lib/a11y';
import { File, Download, X, WifiOff } from 'lucide-react';

// Cache key prefix for attachment blobs
const CACHE_PREFIX = 'attachment_blob_';

function AttachmentItem({ att, isOffline, onClick }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let objectUrl = null;
    const cacheKey = `${CACHE_PREFIX}${att.storage_path}`;

    const fetchAttachment = async () => {
      try {
        // 1. Serve from the local cache when we already have the file
        const cachedBlob = await get(cacheKey);
        if (cachedBlob && isMounted) {
          objectUrl = URL.createObjectURL(cachedBlob);
          setSrc(objectUrl);
          setLoading(false);
          return;
        }

        // 2. Offline without a cached copy — cannot download it
        if (isOffline) {
          if (isMounted) {
            setOfflineUnavailable(true);
            setLoading(false);
          }
          return;
        }

        // 3. Download once, display via object URL, and cache for offline use.
        // A single blob download keeps bandwidth low, never expires, and works
        // with the `download` attribute in the lightbox.
        const { data, error } = await supabase.storage
          .from('attachments')
          .download(att.storage_path);
        if (error) throw error;

        if (data && isMounted) {
          objectUrl = URL.createObjectURL(data);
          setSrc(objectUrl);
          set(cacheKey, data).catch(err => console.warn('Attachment caching failed:', err));
        }
      } catch (err) {
        console.error('Error loading private attachment:', err);
        if (isMounted) {
          setError(true);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchAttachment();

    // Clean up created object URL on unmount to prevent memory leaks
    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [att.storage_path, isOffline]);

  // Click handler that forwards the loaded blob URL to parent for lightbox display
  const handleCardClick = () => {
    if (src) {
      onClick(src);
    }
  };

  const formattedSize = att.file_size 
    ? `${(att.file_size / (1024 * 1024)).toFixed(2)} MB` 
    : 'Unknown size';

  if (loading) {
    return (
      <div className="attachment-preview loading-skeleton" aria-label="Loading attachment">
        <div className="skeleton-pulse" />
      </div>
    );
  }

  if (offlineUnavailable) {
    return (
      <div className="attachment-preview offline-placeholder" title="This memory is stored securely online. Reconnect to download it.">
        <div className="file-icon">
          <WifiOff size={24} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
          <span className="file-meta">Offline</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="attachment-preview error-placeholder" title="Failed to load this memory.">
        <div className="file-icon">
          <File size={24} style={{ color: 'var(--accent-dusty-rose)', marginBottom: '8px' }} />
          <span className="file-meta" style={{ color: 'var(--accent-dusty-rose)' }}>Error loading</span>
        </div>
      </div>
    );
  }

  const isImage = att.file_type?.startsWith('image/');
  const isVideo = att.file_type?.startsWith('video/');

  return (
    <div
      className="attachment-preview loaded"
      {...(src ? clickableProps(handleCardClick) : {})}
      style={{ cursor: src ? 'pointer' : 'default' }}
    >
      {isImage && src ? (
        <img src={src} alt={att.file_name} />
      ) : isVideo && src ? (
        <div className="video-thumbnail-container">
          <video src={src} preload="metadata" muted />
          <div className="video-play-overlay">
            <div className="play-button-icon" />
          </div>
        </div>
      ) : (
        <div className="file-icon generic-file">
          <File size={28} style={{ marginBottom: '8px', color: 'var(--accent-soft-lavender)' }} />
          <span className="file-meta-name" title={att.file_name}>{att.file_name}</span>
          <span className="file-meta-size">{formattedSize}</span>
        </div>
      )}
    </div>
  );
}

function Lightbox({ active, onClose }) {
  const { att, src } = active;
  const isImage = att.file_type?.startsWith('image/');
  const isVideo = att.file_type?.startsWith('video/');

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDownload = () => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = att.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button 
        type="button" 
        className="lightbox-close-btn" 
        onClick={onClose} 
        aria-label="Close viewer"
      >
        <X size={24} />
      </button>

      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {isImage ? (
          <img src={src} alt={att.file_name} className="lightbox-media lightbox-image" />
        ) : isVideo ? (
          <video src={src} controls autoPlay className="lightbox-media lightbox-video" />
        ) : (
          <div className="lightbox-file-card">
            <File size={64} style={{ color: 'var(--accent-soft-lavender)', marginBottom: '16px' }} />
            <h3 style={{ fontSize: '1.25rem', marginBottom: '8px', wordBreak: 'break-all', textAlign: 'center' }}>
              {att.file_name}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '24px' }}>
              {att.file_type || 'Unknown Type'} • {(att.file_size / (1024 * 1024)).toFixed(2)} MB
            </p>
            <button className="btn-primary" onClick={handleDownload}>
              <Download size={18} /> Download Attachment
            </button>
          </div>
        )}
      </div>

      {(isImage || isVideo) && (
        <div className="lightbox-footer" onClick={(e) => e.stopPropagation()}>
          <div className="lightbox-info">
            <span className="lightbox-filename" title={att.file_name}>{att.file_name}</span>
            <span className="lightbox-filesize">{(att.file_size / (1024 * 1024)).toFixed(2)} MB</span>
          </div>
          <button className="lightbox-download-action" onClick={handleDownload} title="Save to device">
            <Download size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function AttachmentViewer({ attachments, isOffline }) {
  const [activeAttachment, setActiveAttachment] = useState(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="attached-memories-section">
      <h4 className="attached-memories-title">Attached memories</h4>
      <div className="attachment-previews">
        {attachments.map((att) => (
          <AttachmentItem
            key={att.id}
            att={att}
            isOffline={isOffline}
            onClick={(src) => setActiveAttachment({ att, src })}
          />
        ))}
      </div>

      {activeAttachment && (
        <Lightbox 
          active={activeAttachment} 
          onClose={() => setActiveAttachment(null)} 
        />
      )}
    </div>
  );
}
