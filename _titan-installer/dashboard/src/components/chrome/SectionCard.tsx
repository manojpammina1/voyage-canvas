interface Props {
  title:     string;
  takeaway?: string;
  children:  React.ReactNode;
}
export default function SectionCard({ title, takeaway, children }: Props) {
  return (
    <div className="bg-white rounded-card shadow-card p-6 mb-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-titan-gray-dark tracking-tight">{title}</h2>
        {takeaway && <p className="text-sm text-titan-gray-mid mt-1 italic">{takeaway}</p>}
      </div>
      {children}
    </div>
  );
}
