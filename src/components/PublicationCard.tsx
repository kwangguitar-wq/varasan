import { Link } from 'react-router-dom';
import type { Publication } from '../lib/types';
import { Icon } from './Icons';
import { biblioYear, typeLabels } from '../lib/format';

export function Cover({
  publication,
  className = '',
  sizes,
}: {
  publication: Pick<Publication, 'title' | 'coverUrl' | 'category' | 'type'>;
  className?: string;
  sizes?: string;
}) {
  return (
    <div className={`cover ${className}`} data-type={publication.type}>
      {publication.coverUrl ? (
        <img src={publication.coverUrl} alt={`หน้าปก ${publication.title}`} loading="lazy" sizes={sizes} />
      ) : (
        <div className="cover-fallback" style={{ background: publication.category?.accent ?? '#0f766e' }}>
          <span>{publication.title}</span>
        </div>
      )}
    </div>
  );
}

export function TypeBadge({ type }: { type: Publication['type'] }) {
  return <span className="type-badge">{typeLabels[type] ?? type}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(100, Math.max(2, value * 100))}%` }} />
    </div>
  );
}

interface CardProps {
  publication: Publication;
  variant?: 'default' | 'compact' | 'row';
  index?: number;
}

export function PublicationCard({ publication, variant = 'default', index }: CardProps) {
  if (variant === 'row') {
    return (
      <Link to={`/item/${publication.slug}`} className="pub-row">
        <Cover publication={publication} className="pub-row-cover" />
        <div className="pub-row-body">
          <div className="pub-row-top">
            <TypeBadge type={publication.type} />
            <span className="pub-year">{biblioYear(publication.year)}</span>
          </div>
          <h3>{publication.title}</h3>
          <p>{publication.excerpt ?? publication.description}</p>
          <div className="pub-row-meta">
            <span>{publication.author ?? 'ไม่ระบุผู้แต่ง'}</span>
            <span className="dot" />
            <span>{publication.category?.name}</span>
            <span className="dot" />
            <span>{publication.pages} หน้า</span>
          </div>
          {publication.progress ? (
            <div className="pub-row-progress">
              <ProgressBar value={publication.progress.progress} />
              <small>อ่านแล้ว {Math.round(publication.progress.progress * 100)}%</small>
            </div>
          ) : null}
        </div>
        <Icon name="chevronRight" size={18} className="pub-row-arrow" />
      </Link>
    );
  }

  return (
    <Link to={`/item/${publication.slug}`} className={`pub-card pub-card-${variant}`}>
      <div className="pub-card-cover">
        <Cover publication={publication} />
        <div className="pub-card-shade" />
        <span className="pub-card-type">
          <TypeBadge type={publication.type} />
        </span>
        {publication.featured ? (
          <span className="pub-card-featured">
            <Icon name="sparkle" size={12} /> แนะนำ
          </span>
        ) : null}
        {publication.progress ? (
          <span className="pub-card-progress">
            <ProgressBar value={publication.progress.progress} />
          </span>
        ) : null}
      </div>
      <div className="pub-card-body">
        <div className="pub-card-meta">
          <span style={{ color: publication.category?.accent }}>{publication.category?.name ?? 'สารสนเทศ'}</span>
          <span className="pub-card-year">{biblioYear(publication.year)}</span>
        </div>
        <h3 title={publication.title}>{publication.title}</h3>
        <p className="pub-card-author">{publication.author ?? 'ไม่ระบุผู้แต่ง'}</p>
        {index === undefined ? null : <span className="pub-card-index">{String(index + 1).padStart(2, '0')}</span>}
        <div className="pub-card-footer">
          <span>
            <Icon name="eye" size={14} /> {new Intl.NumberFormat('th-TH', { notation: 'compact' }).format(publication.reads)}
          </span>
          <span>
            <Icon name="download" size={14} /> {new Intl.NumberFormat('th-TH', { notation: 'compact' }).format(publication.downloads)}
          </span>
          <span className="pub-card-read">
            อ่าน <Icon name="arrowRight" size={14} />
          </span>
        </div>
      </div>
    </Link>
  );
}
