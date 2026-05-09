import { useRef, useState, useEffect } from 'react';
import { Paperclip, X, File, Video, Image as ImageIcon } from 'lucide-react';

export default function AttachmentUploader({ files, setFiles, isOffline }) {
  const fileInputRef = useRef(null);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    setError('');
    const selectedFiles = Array.from(e.target.files);
    
    if (files.length + selectedFiles.length > 5) {
      setError('You can only attach up to 5 files per entry.');
      return;
    }

    const validFiles = [];
    for (const file of selectedFiles) {
      if (file.type.startsWith('image/') && file.size > 10 * 1024 * 1024) {
        setError('Images must be smaller than 10MB.');
        continue;
      }
      if (file.type.startsWith('video/') && file.size > 100 * 1024 * 1024) {
        setError('Videos must be smaller than 100MB.');
        continue;
      }
      file.preview = URL.createObjectURL(file);
      validFiles.push(file);
    }

    setFiles(prev => [...prev, ...validFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index) => {
    setFiles(prev => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  useEffect(() => {
    // Cleanup previews on unmount
    return () => {
      files.forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []);

  return (
    <div className="attachment-uploader">
      {isOffline ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Attachments are disabled while offline.
        </p>
      ) : (
        <>
          <button 
            type="button" 
            className="attachment-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={files.length >= 5}
          >
            <Paperclip size={18} />
            <span>Add memory</span>
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            multiple 
            accept="image/*,video/*,application/pdf,text/plain" 
            style={{ display: 'none' }}
          />

          {error && <p style={{ color: 'var(--accent-dusty-rose)', fontSize: '0.85rem', marginTop: '8px' }}>{error}</p>}

          {files.length > 0 && (
            <div className="attachment-previews">
              {files.map((file, i) => (
                <div key={i} className="attachment-preview">
                  <button type="button" className="remove-attachment-btn" onClick={() => removeFile(i)}>
                    <X size={14} />
                  </button>
                  {file.type.startsWith('image/') ? (
                    <img src={file.preview} alt="preview" />
                  ) : file.type.startsWith('video/') ? (
                    <video src={file.preview} controls={false} />
                  ) : (
                    <div className="file-icon">
                      <File size={32} style={{ marginBottom: '8px' }} />
                      <span style={{ fontSize: '0.7rem', textAlign: 'center', wordBreak: 'break-all', padding: '0 4px' }}>
                        {file.name.substring(0, 20)}{file.name.length > 20 ? '...' : ''}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
