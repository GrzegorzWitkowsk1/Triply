interface PlaceholderPageProps {
  title: string;
}

export default function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="page-placeholder">
      <h1>{title}</h1>
      <p>Coming soon.</p>
    </div>
  );
}